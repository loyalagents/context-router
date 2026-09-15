#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertCallerIntegrity,
  captureCallerIntegrity,
  copyWorkspaceFiles,
  linkDependencyTrees,
  redactSecrets,
  runCommand,
  runPhaseSequence,
  validateMergeBase,
  validatePhaseManifest,
  writeSanitizedJson,
} from "./gate-runner.mjs";
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  prepareTestAdministration,
  queryDatabase,
} from "./test-database.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const dependencyRoots = ["", "apps/backend", "apps/web", "apps/local-orchestrator"];
const callerIntegrityPaths = [
  path.join(repositoryRoot, "apps/backend/src/schema.gql"),
  path.join(repositoryRoot, "apps/backend/src/generated/prisma"),
  path.join(repositoryRoot, "apps/web/lib/generated"),
];

async function gitCapture(args, { cwd = repositoryRoot, encoding = "utf8" } = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? (encoding === "buffer" ? Buffer.alloc(0) : ""),
      stderr: error.stderr ?? "",
    };
  }
}

async function requireGitSuccess(args, options) {
  const result = await gitCapture(args, options);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${redactSecrets(result.stderr)}`);
  }
  return result.stdout;
}

async function selectAndValidateBaseSha(environment) {
  let candidate = environment.MIGRATION_GATE_BASE_SHA;
  if (!candidate) {
    candidate = await requireGitSuccess(["merge-base", "HEAD", "origin/main"]);
  }
  return validateMergeBase(candidate, (args) => gitCapture(args));
}

async function listWorkspaceFiles() {
  const output = await requireGitSuccess(
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { encoding: "buffer" },
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => {
      const parts = relativePath.split("/");
      return !parts.some((part) => [".git", "node_modules", "dist", ".next"].includes(part));
    });
}

async function prepareDisposableWorkspace(diagnosticsDirectory) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "context-router-lmbg-workspace-"));
  await chmod(workspace, 0o700);
  const files = await listWorkspaceFiles();
  await copyWorkspaceFiles(repositoryRoot, workspace, files);
  const setupLog = (name) => path.join(diagnosticsDirectory, `workspace-${name}.log`);
  await runCommand(["git", "init", "--quiet"], {
    cwd: workspace,
    timeoutMs: 30_000,
    logPath: setupLog("git-init"),
  });
  await runCommand(["git", "config", "user.name", "Local Migration Gate"], {
    cwd: workspace,
    timeoutMs: 30_000,
    logPath: setupLog("git-config-name"),
  });
  await runCommand(["git", "config", "user.email", "migration-gate@invalid.local"], {
    cwd: workspace,
    timeoutMs: 30_000,
    logPath: setupLog("git-config-email"),
  });
  await runCommand(["git", "add", "--all"], {
    cwd: workspace,
    timeoutMs: 60_000,
    logPath: setupLog("git-add"),
  });
  await runCommand(["git", "commit", "--quiet", "--no-gpg-sign", "-m", "Disposable migration gate snapshot"], {
    cwd: workspace,
    timeoutMs: 60_000,
    logPath: setupLog("git-commit"),
  });
  await linkDependencyTrees(repositoryRoot, workspace, dependencyRoots);
  return { workspace, files };
}

async function gitShow(baseSha, relativePath) {
  const result = await gitCapture(["show", `${baseSha}:${relativePath}`], { encoding: "buffer" });
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

async function writeBaseArtifact(baseDirectory, relativePath, content) {
  const destination = path.join(baseDirectory, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, { mode: 0o444 });
  return {
    path: relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function exportBaseContracts(baseSha, diagnosticsDirectory) {
  const baseDirectory = path.join(diagnosticsDirectory, "merge-base-contracts");
  await mkdir(baseDirectory, { recursive: true, mode: 0o700 });
  const artifacts = [];
  for (const producer of [
    "apps/backend/src/schema.gql",
    "apps/backend/src/config/preferences.catalog.json",
  ]) {
    const content = await gitShow(baseSha, producer);
    if (!content) throw new Error(`merge base lacks required producer ${producer}`);
    artifacts.push(await writeBaseArtifact(baseDirectory, producer, content));
  }

  const registryPath = "docs/current/local-migration-contract-baseline.json";
  const registryContent = await gitShow(baseSha, registryPath);
  if (!registryContent) {
    const marker = Buffer.from(
      `${JSON.stringify({ baseSha, registryAbsent: true, version: 1 }, null, 2)}\n`,
    );
    artifacts.push(await writeBaseArtifact(baseDirectory, "bootstrap-v1.json", marker));
  } else {
    artifacts.push(await writeBaseArtifact(baseDirectory, registryPath, registryContent));
    const registry = JSON.parse(registryContent.toString("utf8"));
    const referenced = [
      registry.contracts.graphql.fixture,
      registry.contracts.http.fixture,
      registry.contracts.mcp.fixture,
      registry.contracts.manifest.schema,
    ];
    for (const relativePath of referenced) {
      const content = await gitShow(baseSha, relativePath);
      if (!content) throw new Error(`merge base registry references missing contract ${relativePath}`);
      artifacts.push(await writeBaseArtifact(baseDirectory, relativePath, content));
    }
  }
  await writeSanitizedJson(path.join(baseDirectory, "artifact-hashes.json"), {
    baseSha,
    artifacts,
  });
  return baseDirectory;
}

function allowlistedEnvironment(source, temporaryHome) {
  const passThrough = [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SHELL",
    "TERM",
    "COLORTERM",
    "PNPM_HOME",
  ];
  const environment = Object.fromEntries(
    passThrough.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
  return {
    ...environment,
    HOME: temporaryHome,
    XDG_CACHE_HOME: path.join(temporaryHome, ".cache"),
    CI: "1",
    NODE_ENV: "test",
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    COREPACK_HOME:
      source.COREPACK_HOME ?? path.join(os.homedir(), ".cache", "node", "corepack"),
    COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
    GRAPHQL_PLAYGROUND: "false",
    GRAPHQL_DEBUG: "false",
    CORS_ORIGIN: "http://localhost:3001",
    MCP_HTTP_ALLOWED_ORIGINS: "http://localhost:3001",
    GCP_PROJECT_ID: "migration-gate-deny-provider",
    GOOGLE_CLOUD_PROJECT: "migration-gate-deny-provider",
    VERTEX_REGION: "us-central1",
    VERTEX_MODEL_ID: "migration-gate-no-live-model",
    METADATA_SERVER_DETECTION: "none",
    DOC_UPLOAD_MAX_BYTES: "10485760",
    DOC_UPLOAD_MAX_SUGGESTIONS: "25",
    MCP_SERVER_URL: "http://127.0.0.1:3001",
    MCP_RESOURCE: "http://127.0.0.1:3001/mcp",
    MCP_HTTP_ENABLED: "true",
    MCP_HTTP_REQUIRE_AUTH: "true",
    MCP_STDIO_ENABLED: "false",
    MCP_TOOLS_PREFERENCES_ENABLED: "true",
    MCP_RESOURCES_SCHEMA_ENABLED: "true",
    AUTH0_DOMAIN: "migration-gate.invalid",
    AUTH0_ISSUER: "https://migration-gate.invalid/",
    AUTH0_AUDIENCE: "urn:context-router:migration-gate",
    AUTH0_CLIENT_ID: "migration-gate-client",
    AUTH0_CLIENT_SECRET: "synthetic-migration-gate-secret",
    AUTH0_MCP_CLAUDE_CLIENT_ID: "migration-gate-claude",
    AUTH0_MCP_CODEX_CLIENT_ID: "migration-gate-codex",
    AUTH0_MCP_FALLBACK_CLIENT_ID: "migration-gate-fallback",
    AUTH0_MCP_PUBLIC_CLIENT_ID: "migration-gate-fallback",
  };
}

async function validatePython312(pythonBin, workspace, diagnosticsDirectory, environment) {
  const result = await runCommand([pythonBin, "--version"], {
    cwd: workspace,
    env: environment,
    timeoutMs: 30_000,
    logPath: path.join(diagnosticsDirectory, "preflight-python.log"),
  });
  if (!/Python 3\.12\./.test(result.outputTail)) {
    throw new Error(
      `LMBG requires Python 3.12; supply MIGRATION_GATE_PYTHON_BIN or PYTHON_BIN with an exact 3.12 executable`,
    );
  }
  return pythonBin;
}

async function runPreflight({ workspace, diagnosticsDirectory, environment, pythonBin }) {
  const checks = [
    ["node", [process.execPath, "--version"]],
    ["pnpm", ["pnpm", "--version"]],
  ];
  const versions = {};
  for (const [name, argv] of checks) {
    const result = await runCommand(argv, {
      cwd: workspace,
      env: environment,
      timeoutMs: 30_000,
      logPath: path.join(diagnosticsDirectory, `preflight-${name}.log`),
    });
    versions[name] = result.outputTail.replace(/^\[stdout\]\s*/, "").trim();
  }
  await validatePython312(pythonBin, workspace, diagnosticsDirectory, environment);
  versions.python = "3.12";
  return versions;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function executeFullGate({
  workspace,
  diagnosticsDirectory,
  baseSha,
  baseDirectory,
  sourceEnvironment,
}) {
  const manifest = JSON.parse(
    await readFile(path.join(workspace, "scripts/local-migration/gate-phases.json"), "utf8"),
  );
  const require = createRequire(path.join(workspace, "package.json"));
  const Ajv2020 = require("ajv/dist/2020").default;
  const manifestSchema = JSON.parse(
    await readFile(path.join(workspace, "scripts/local-migration/gate-phases.schema.json"), "utf8"),
  );
  const validateSchema = new Ajv2020({ strict: true }).compile(manifestSchema);
  if (!validateSchema(manifest)) {
    throw new Error(`gate phase manifest violates schema: ${JSON.stringify(validateSchema.errors)}`);
  }
  const semanticErrors = validatePhaseManifest(manifest);
  if (semanticErrors.length) throw new Error(`gate phase manifest invalid: ${semanticErrors.join("; ")}`);
  const phases = manifest.phases.filter((phase) => phase.status === "active");

  const temporaryHome = path.join(workspace, ".lmbg-home");
  await mkdir(path.join(temporaryHome, ".cache"), { recursive: true, mode: 0o700 });
  const gateEnvironment = allowlistedEnvironment(sourceEnvironment, temporaryHome);
  const pythonBin =
    sourceEnvironment.MIGRATION_GATE_PYTHON_BIN ??
    sourceEnvironment.PYTHON_BIN ??
    "python3.12";
  const versions = await runPreflight({
    workspace,
    diagnosticsDirectory,
    environment: gateEnvironment,
    pythonBin,
  });
  gateEnvironment.PYTHON_BIN = pythonBin;
  gateEnvironment.MIGRATION_GATE_BASE_SHA = baseSha;
  gateEnvironment.MIGRATION_GATE_BASELINE_DIR = baseDirectory;
  gateEnvironment.MIGRATION_GATE_DIAGNOSTICS_DIR = diagnosticsDirectory;
  gateEnvironment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR = path.join(
    diagnosticsDirectory,
    "restart-smoke",
  );
  gateEnvironment.MIGRATION_GATE_TRACKED_SDL_SHA256 = await sha256(
    path.join(workspace, "apps/backend/src/schema.gql"),
  );

  const summary = {
    status: "running",
    baseSha,
    versions: { ...versions, postgres: "pending" },
    administrationSource: "pending",
    databaseName: null,
    phases: [],
    cleanup: [],
  };
  let administration;
  let database;
  let primaryError;
  const lifecycleErrors = [];
  const phaseStart = new Map();
  try {
    administration = await prepareTestAdministration({
      repositoryRoot: workspace,
      diagnosticsDirectory,
      environment: sourceEnvironment,
    });
    summary.administrationSource = administration.source;
    database = await createIsolatedTestDatabase(
      workspace,
      administration.administrationUrl,
    );
    summary.databaseName = database.databaseName;
    gateEnvironment.DATABASE_URL = database.databaseUrl;
    gateEnvironment.MIGRATION_TEST_ADMIN_URL = administration.administrationUrl;
    const serverVersion = await queryDatabase(
      workspace,
      database.databaseUrl,
      "SHOW server_version",
    );
    summary.versions.postgres = serverVersion[0]?.server_version ?? "unknown";
    summary.phases = await runPhaseSequence(phases, {
      onPhaseStart: async (phase) => {
        phaseStart.set(phase.id, Date.now());
        console.log(`migration-gate: phase ${phase.order}/11 ${phase.id} started`);
      },
      execute: async (command, phase) => {
        const commandIndex = phase.commands.indexOf(command) + 1;
        const elapsed = Date.now() - phaseStart.get(phase.id);
        const remaining = Math.max(1, phase.timeoutMs - elapsed);
        await runCommand(command.argv, {
          cwd: workspace,
          env: gateEnvironment,
          timeoutMs: remaining,
          logPath: path.join(
            diagnosticsDirectory,
            `phase-${String(phase.order).padStart(2, "0")}-${phase.id}-${commandIndex}.log`,
          ),
        });
      },
      onPhaseFinish: async (phase, result) => {
        console.log(`migration-gate: phase ${phase.order}/11 ${phase.id} passed (${result.elapsedMs}ms)`);
      },
      onSummary: async (phasesSummary) => {
        summary.phases = phasesSummary;
        await writeSanitizedJson(path.join(diagnosticsDirectory, "summary.json"), summary);
      },
    });
    summary.status = "passed";
  } catch (error) {
    primaryError = error;
    summary.status = "failed";
    summary.failure = {
      phase: error.phase ?? null,
      exitCode: error.exitCode ?? 1,
      signal: error.signal ?? null,
      message: redactSecrets(error.message),
    };
  } finally {
    if (database && administration) {
      try {
        await dropIsolatedTestDatabase(
          workspace,
          administration.administrationUrl,
          database.databaseName,
        );
        summary.cleanup.push({
          resource: "database",
          status: "removed",
          name: database.databaseName,
        });
      } catch (error) {
        lifecycleErrors.push(error);
        summary.cleanup.push({
          resource: "database",
          status: "failed",
          message: redactSecrets(error.message),
        });
      }
    }
    if (administration) {
      try {
        await administration.cleanup();
        summary.cleanup.push({ resource: "administration", status: "clean" });
      } catch (error) {
        lifecycleErrors.push(error);
        summary.cleanup.push({
          resource: "administration",
          status: "failed",
          message: redactSecrets(error.message),
        });
      }
    }
    if (lifecycleErrors.length && summary.status === "passed") {
      summary.status = "failed";
      summary.failure = {
        phase: null,
        exitCode: 1,
        signal: null,
        message: "gate cleanup failed",
      };
    }
    try {
      await writeSanitizedJson(path.join(diagnosticsDirectory, "summary.json"), summary);
    } catch (error) {
      lifecycleErrors.push(error);
    }
  }

  if (primaryError || lifecycleErrors.length) {
    const message = [
      primaryError?.message,
      ...lifecycleErrors.map((error) => `cleanup/diagnostics failure: ${error.message}`),
    ]
      .filter(Boolean)
      .join("; ");
    const error = new Error(redactSecrets(message), {
      cause: primaryError ?? lifecycleErrors[0],
    });
    error.phase = primaryError?.phase ?? null;
    error.exitCode = primaryError?.exitCode ?? 1;
    error.signal = primaryError?.signal ?? null;
    error.gateSummary = summary;
    throw error;
  }
  return summary;
}

async function executeSmokeOnly({ workspace, diagnosticsDirectory, sourceEnvironment }) {
  const temporaryHome = path.join(workspace, ".lmbg-home");
  await mkdir(temporaryHome, { recursive: true, mode: 0o700 });
  const environment = allowlistedEnvironment(sourceEnvironment, temporaryHome);
  if (sourceEnvironment.MIGRATION_TEST_ADMIN_URL) {
    environment.MIGRATION_TEST_ADMIN_URL = sourceEnvironment.MIGRATION_TEST_ADMIN_URL;
  }
  environment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR = path.join(
    diagnosticsDirectory,
    "restart-smoke",
  );
  await runCommand([process.execPath, "scripts/local-migration/restart-smoke.mjs"], {
    cwd: workspace,
    env: environment,
    timeoutMs: 600_000,
    logPath: path.join(diagnosticsDirectory, "restart-smoke-command.log"),
  });
  return { status: "passed", mode: "smoke-only" };
}

async function main() {
  const smokeOnly = process.argv.includes("--smoke-only");
  const startedAt = Date.now();
  const diagnosticsDirectory = await mkdtemp(
    path.join(os.tmpdir(), smokeOnly ? "context-router-smoke-run-" : "context-router-lmbg-"),
  );
  await chmod(diagnosticsDirectory, 0o700);
  const callerIntegrity = await captureCallerIntegrity(callerIntegrityPaths);
  let disposable;
  let succeeded = false;
  let result;
  let primaryError;
  const cleanupErrors = [];
  try {
    let baseSha;
    let baseDirectory;
    if (!smokeOnly) {
      baseSha = await selectAndValidateBaseSha(process.env);
      for (const [name, args] of [
        ["base-to-head", ["diff", "--check", `${baseSha}...HEAD`]],
        ["worktree", ["diff", "--check"]],
        ["index", ["diff", "--cached", "--check"]],
      ]) {
        await runCommand(["git", ...args], {
          cwd: repositoryRoot,
          timeoutMs: 60_000,
          logPath: path.join(diagnosticsDirectory, `caller-${name}-whitespace.log`),
        });
      }
      baseDirectory = await exportBaseContracts(baseSha, diagnosticsDirectory);
    }
    disposable = await prepareDisposableWorkspace(diagnosticsDirectory);
    result = smokeOnly
      ? await executeSmokeOnly({
          workspace: disposable.workspace,
          diagnosticsDirectory,
          sourceEnvironment: process.env,
        })
      : await executeFullGate({
          workspace: disposable.workspace,
          diagnosticsDirectory,
          baseSha,
          baseDirectory,
          sourceEnvironment: process.env,
        });
    succeeded = true;
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await assertCallerIntegrity(callerIntegrity);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (disposable?.workspace) {
      try {
        await rm(disposable.workspace, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  if (primaryError || cleanupErrors.length) {
    const summary = primaryError?.gateSummary ?? {
      status: "failed",
      mode: smokeOnly ? "smoke-only" : "full",
    };
    summary.elapsedMs = Date.now() - startedAt;
    summary.failure ??= primaryError
      ? { message: redactSecrets(primaryError.message), exitCode: primaryError.exitCode ?? 1 }
      : null;
    summary.cleanupErrors = cleanupErrors.map((error) => redactSecrets(error.message));
    await writeSanitizedJson(path.join(diagnosticsDirectory, "summary.json"), summary);
    const combined = [primaryError?.message, ...cleanupErrors.map((error) => `cleanup/integrity: ${error.message}`)]
      .filter(Boolean)
      .join("; ");
    console.error(`migration-gate: failed: ${redactSecrets(combined)}`);
    console.error(`migration-gate: sanitized diagnostics retained at ${diagnosticsDirectory}`);
    process.exitCode = primaryError?.exitCode ?? 1;
    return;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    smokeOnly
      ? `migration-smoke: ok; disposable caller-integrity=true elapsedMs=${elapsedMs}`
      : `migration-gate: ok; phases=${result.phases.length} caller-integrity=true elapsedMs=${elapsedMs}`,
  );
  await rm(diagnosticsDirectory, { recursive: true, force: true });
}

await main();
