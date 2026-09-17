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
  assertContractBaselineComparisonPerformed,
  buildIsolatedGateEnvironment,
  buildIsolatedGitEnvironment,
  buildPhaseEnvironment,
  captureCallerIntegrity,
  cloneCorepackCache,
  cloneDependencyTrees,
  copyWorkspaceFiles,
  createResourceLifecycleJournal,
  createSignalAbortController,
  gitWithoutHooks,
  loadAcceptedDecisionEvidence,
  prepareOwnedTemporaryDirectory,
  readContractBaselineComparisonEvidence,
  redactSecrets,
  resolveOwnedArtifactPath,
  runCommand,
  runPhaseSequence,
  validateMergeBase,
  validateApprovedPhaseCommands,
  validatePhaseManifest,
  writeSanitizedJson,
} from "./gate-runner.mjs";
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  prepareTestAdministration,
  queryDatabase,
} from "./test-database.mjs";
import { RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS } from "./restart-smoke.mjs";
import {
  checkCurrentToolchain,
  EXPECTED_PNPM_VERSION,
  TOOLCHAIN_ERROR_MESSAGE,
} from "../check-toolchain.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const dependencyRoots = ["", "apps/backend", "apps/web", "apps/local-orchestrator"];
const callerIntegrityPaths = [
  path.join(repositoryRoot, "apps/backend/src/schema.gql"),
  path.join(repositoryRoot, "apps/backend/src/generated/prisma"),
  path.join(repositoryRoot, "apps/web/lib/generated"),
];
export const RESTART_SMOKE_TERMINATION_GRACE_MS =
  RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS + 20_000;

export function terminationGraceForPhase(phase) {
  return phase.kind === "restart-smoke"
    ? RESTART_SMOKE_TERMINATION_GRACE_MS
    : 5_000;
}

export function buildAdministrationCanaries(
  administrationUrl,
  additionalCanaries = [],
) {
  const canaries = [...additionalCanaries].filter(Boolean);
  if (administrationUrl) {
    try {
      const encodedPassword = new URL(administrationUrl).password;
      if (encodedPassword) {
        canaries.push(encodedPassword);
        try {
          canaries.push(decodeURIComponent(encodedPassword));
        } catch {
          // The encoded form remains protected even if it is malformed.
        }
      }
    } catch {
      // Administration URL validation is owned by the database helper.
    }
  }
  return [...new Set(canaries)];
}

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
  const [output, deletedOutput] = await Promise.all([
    requireGitSuccess(
      ["ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "buffer" },
    ),
    requireGitSuccess(["ls-files", "--deleted", "-z"], {
      encoding: "buffer",
    }),
  ]);
  const deleted = new Set(
    deletedOutput.toString("utf8").split("\0").filter(Boolean),
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => !deleted.has(relativePath))
    .filter((relativePath) => {
      const parts = relativePath.split("/");
      return !parts.some((part) => [".git", "node_modules", "dist", ".next"].includes(part));
    });
}

async function prepareDisposableWorkspace(diagnosticsDirectory, signal) {
  const prepared = await prepareOwnedTemporaryDirectory(
    path.join(os.tmpdir(), "context-router-lmbg-workspace-"),
    async (workspace) => {
      const files = await listWorkspaceFiles();
      await copyWorkspaceFiles(repositoryRoot, workspace, files);
      const setupLog = (name) => path.join(diagnosticsDirectory, `workspace-${name}.log`);
      const gitHome = path.join(workspace, ".lmbg-git-home");
      await mkdir(gitHome, { recursive: true, mode: 0o700 });
      const gitEnvironment = buildIsolatedGitEnvironment(process.env, gitHome);
      for (const [argv, logName, timeoutMs] of [
        [["init", "--quiet"], "git-init", 30_000],
        [["config", "user.name", "Local Migration Gate"], "git-config-name", 30_000],
        [["config", "user.email", "migration-gate@invalid.local"], "git-config-email", 30_000],
        [["add", "--all"], "git-add", 60_000],
        [["commit", "--quiet", "--no-gpg-sign", "-m", "Disposable migration gate snapshot"], "git-commit", 60_000],
      ]) {
        await runCommand(gitWithoutHooks(argv), {
          cwd: workspace,
          env: gitEnvironment,
          timeoutMs,
          logPath: setupLog(logName),
          signal,
        });
      }
      await cloneDependencyTrees(repositoryRoot, workspace, dependencyRoots, {
        signal,
      });
      const sourceCorepackHome =
        process.env.COREPACK_HOME ??
        path.join(
          process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
          "node",
          "corepack",
        );
      const corepackHome = path.join(diagnosticsDirectory, "corepack-home");
      const cachedPnpmVersions = await cloneCorepackCache(
        sourceCorepackHome,
        corepackHome,
        { signal, requiredPnpmVersion: EXPECTED_PNPM_VERSION },
      );
      return { files, corepackHome, cachedPnpmVersions };
    },
  );
  return { workspace: prepared.directory, ...prepared.value };
}

async function gitShow(baseSha, relativePath) {
  const result = await gitCapture(["show", `${baseSha}:${relativePath}`], { encoding: "buffer" });
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

async function writeBaseArtifact(baseDirectory, relativePath, content) {
  const destination = await resolveOwnedArtifactPath(baseDirectory, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, { mode: 0o444, flag: "wx" });
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
    await resolveOwnedArtifactPath(baseDirectory, producer);
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
      registry.contracts.catalog.fixture,
      registry.contracts.http.fixture,
      registry.contracts.mcp.fixture,
      registry.contracts.manifest.schema,
    ];
    for (const relativePath of referenced) {
      await resolveOwnedArtifactPath(baseDirectory, relativePath);
      const content = await gitShow(baseSha, relativePath);
      if (!content) throw new Error(`merge base registry references missing contract ${relativePath}`);
      artifacts.push(await writeBaseArtifact(baseDirectory, relativePath, content));
    }
  }
  const hashManifestPath = path.join(baseDirectory, "artifact-hashes.json");
  await writeSanitizedJson(hashManifestPath, {
    baseSha,
    artifacts,
  });
  return {
    baseDirectory,
    manifestSha256: await sha256(hashManifestPath),
  };
}

async function validatePython312(pythonBin, workspace, diagnosticsDirectory, environment, signal) {
  const result = await runCommand([pythonBin, "--version"], {
    cwd: workspace,
    env: environment,
    timeoutMs: 30_000,
    logPath: path.join(diagnosticsDirectory, "preflight-python.log"),
    signal,
  });
  const match = result.outputTail.match(/Python\s+(3\.12\.[0-9]+(?:[^\s]*)?)/);
  if (!match) {
    throw new Error(
      `LMBG requires Python 3.12; supply MIGRATION_GATE_PYTHON_BIN or PYTHON_BIN with an exact 3.12 executable`,
    );
  }
  return match[1];
}

async function runPreflight({ workspace, diagnosticsDirectory, environment, pythonBin, signal }) {
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
      signal,
    });
    versions[name] = result.outputTail.replace(/^\[stdout\]\s*/, "").trim();
  }
  versions.python = await validatePython312(
    pythonBin,
    workspace,
    diagnosticsDirectory,
    environment,
    signal,
  );
  return versions;
}

function preflightValue(value) {
  return redactSecrets(String(value)).replace(/\s+/g, " ").trim();
}

export function formatPreflightEvidence({
  baseSha,
  versions,
  administrationSource,
}) {
  return (
    "migration-gate: preflight " +
    `base=${preflightValue(baseSha)} ` +
    `node=${preflightValue(versions.node)} ` +
    `pnpm=${preflightValue(versions.pnpm)} ` +
    `python=${preflightValue(versions.python)} ` +
    `postgres=${preflightValue(versions.postgres)} ` +
    `administration=${preflightValue(administrationSource)}`
  );
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function executeFullGate({
  workspace,
  diagnosticsDirectory,
  baseSha,
  baseDirectory,
  baseManifestSha256,
  sourceEnvironment,
  corepackHome,
  signal,
}) {
  const summary = {
    status: "running",
    baseSha,
    versions: {
      node: "pending",
      pnpm: "pending",
      python: "pending",
      postgres: "pending",
    },
    administrationSource: "pending",
    databaseName: null,
    baseComparison: "pending",
    phases: [],
    cleanup: [],
  };
  let lifecycle;
  let administration;
  let database;
  let primaryError;
  const lifecycleErrors = [];
  const phaseStart = new Map();
  const sensitiveCanaries = buildAdministrationCanaries(
    sourceEnvironment.MIGRATION_TEST_ADMIN_URL,
  );
  const addSensitiveCanaries = (values) => {
    for (const value of values) {
      if (!value) continue;
      if (!sensitiveCanaries.includes(value)) sensitiveCanaries.push(value);
      lifecycle?.addCanary(value);
    }
  };
  try {
    if (signal?.aborted) throw signal.reason;
    lifecycle = await createResourceLifecycleJournal(
      diagnosticsDirectory,
      {
        filename: "gate-resource-lifecycle.json",
        canaries: sensitiveCanaries,
      },
    );
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
    const decisionExists = await loadAcceptedDecisionEvidence(
      workspace,
      manifest,
    );
    const semanticErrors = validatePhaseManifest(manifest, { decisionExists });
    if (semanticErrors.length) throw new Error(`gate phase manifest invalid: ${semanticErrors.join("; ")}`);
    const commandPolicyErrors = validateApprovedPhaseCommands(manifest);
    if (commandPolicyErrors.length) throw new Error(`gate command policy invalid: ${commandPolicyErrors.join("; ")}`);
    const phases = manifest.phases.filter((phase) => phase.status === "active");
    const phaseTotal = phases.length;

    const temporaryHome = path.join(workspace, ".lmbg-home");
    await mkdir(path.join(temporaryHome, ".cache"), { recursive: true, mode: 0o700 });
    const gateEnvironment = buildIsolatedGateEnvironment(
      sourceEnvironment,
      temporaryHome,
      corepackHome,
    );
    addSensitiveCanaries([gateEnvironment.AUTH0_CLIENT_SECRET]);
    const pythonBin =
      sourceEnvironment.MIGRATION_GATE_PYTHON_BIN ??
      sourceEnvironment.PYTHON_BIN ??
      "python3.12";
    const versions = await runPreflight({
      workspace,
      diagnosticsDirectory,
      environment: gateEnvironment,
      pythonBin,
      signal,
    });
    summary.versions = { ...versions, postgres: "pending" };
    const trackedSdlSha256 = await sha256(
      path.join(workspace, "apps/backend/src/schema.gql"),
    );

    administration = await prepareTestAdministration({
      repositoryRoot: workspace,
      diagnosticsDirectory,
      environment: sourceEnvironment,
      signal,
      lifecycle,
    });
    addSensitiveCanaries(
      buildAdministrationCanaries(administration.administrationUrl),
    );
    summary.administrationSource = administration.source;
    database = await createIsolatedTestDatabase(
      workspace,
      administration.administrationUrl,
      { signal, lifecycle },
    );
    summary.databaseName = database.databaseName;
    const serverVersion = await queryDatabase(
      workspace,
      database.databaseUrl,
      "SHOW server_version",
      [],
      { signal },
    );
    summary.versions.postgres = serverVersion[0]?.server_version ?? "unknown";
    console.log(
      formatPreflightEvidence({
        baseSha,
        versions: summary.versions,
        administrationSource: summary.administrationSource,
      }),
    );
    summary.phases = await runPhaseSequence(phases, {
      onPhaseStart: async (phase) => {
        phaseStart.set(phase.id, Date.now());
        console.log(`migration-gate: phase ${phase.order}/${phaseTotal} ${phase.id} started`);
      },
      execute: async (command, phase) => {
        const commandIndex = phase.commands.indexOf(command) + 1;
        const elapsed = Date.now() - phaseStart.get(phase.id);
        const remaining = Math.max(1, phase.timeoutMs - elapsed);
        const phaseEnvironment = buildPhaseEnvironment(
          gateEnvironment,
          phase.id,
          {
            commandArgv: command.argv,
            databaseUrl: database.databaseUrl,
            administrationUrl: administration.administrationUrl,
            baseSha,
            baseDirectory,
            baseManifestSha256,
            diagnosticsDirectory,
            pythonBin,
            pythonCacheDirectory: path.join(
              workspace,
              ".lmbg-python-cache",
            ),
            trackedSdlSha256,
          },
        );
        const commandResult = await runCommand(command.argv, {
          cwd: workspace,
          env: phaseEnvironment,
          timeoutMs: remaining,
          logPath: path.join(
            diagnosticsDirectory,
            `phase-${String(phase.order).padStart(2, "0")}-${phase.id}-${commandIndex}.log`,
          ),
          signal,
          terminationGraceMs: terminationGraceForPhase(phase),
          canaries: sensitiveCanaries,
        });
        const comparisonEvidence = readContractBaselineComparisonEvidence(
          command.argv,
          commandResult.outputTail,
        );
        if (comparisonEvidence) summary.baseComparison = comparisonEvidence;
      },
      onPhaseFinish: async (phase, result) => {
        if (phase.id === "contract-baseline") {
          assertContractBaselineComparisonPerformed(summary.baseComparison);
        }
        console.log(`migration-gate: phase ${phase.order}/${phaseTotal} ${phase.id} passed (${result.elapsedMs}ms)`);
      },
      onSummary: async (phasesSummary) => {
        summary.phases = phasesSummary;
        await writeSanitizedJson(
          path.join(diagnosticsDirectory, "summary.json"),
          summary,
          sensitiveCanaries,
        );
      },
    });
    summary.status = "passed";
  } catch (error) {
    primaryError = error;
    summary.status = signal?.aborted ? "cancelled" : "failed";
    summary.failure = {
      phase: error.phase ?? null,
      exitCode: error.exitCode ?? 1,
      signal: error.signal ?? null,
      message: redactSecrets(error.message, sensitiveCanaries),
    };
  } finally {
    if (database && administration) {
      let databaseCleanupError;
      try {
        await dropIsolatedTestDatabase(
          workspace,
          administration.administrationUrl,
          database.databaseName,
          { expectedOwnershipMarker: database.ownershipMarker },
        );
        summary.cleanup.push({
          resource: "database",
          status: "removed",
          name: database.databaseName,
        });
      } catch (error) {
        databaseCleanupError = error;
        lifecycleErrors.push(error);
        summary.cleanup.push({
          resource: "database",
          status: "failed",
          message: redactSecrets(error.message, sensitiveCanaries),
        });
      }
      try {
        await lifecycle?.cleanupFinished("database", {
          status: databaseCleanupError ? "failed" : "removed",
          error: databaseCleanupError,
        });
      } catch (error) {
        lifecycleErrors.push(error);
      }
    }
    if (administration) {
      let administrationCleanupError;
      try {
        await administration.cleanup();
        summary.cleanup.push({ resource: "administration", status: "clean" });
      } catch (error) {
        administrationCleanupError = error;
        lifecycleErrors.push(error);
        summary.cleanup.push({
          resource: "administration",
          status: "failed",
          message: redactSecrets(error.message, sensitiveCanaries),
        });
      }
      try {
        await lifecycle?.cleanupFinished(
          administration.containerName ? "container" : "administration",
          {
            status: administrationCleanupError
              ? "failed"
              : administration.containerName
                ? "removed"
                : "not-owned",
            error: administrationCleanupError,
          },
        );
      } catch (error) {
        lifecycleErrors.push(error);
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
      await writeSanitizedJson(
        path.join(diagnosticsDirectory, "summary.json"),
        summary,
        sensitiveCanaries,
      );
    } catch (error) {
      lifecycleErrors.push(error);
    }
    if (lifecycle) {
      try {
        await lifecycle.finish(
          primaryError || lifecycleErrors.length
            ? signal?.aborted
              ? "cancelled"
              : "failed"
            : "passed",
          primaryError ?? lifecycleErrors[0],
        );
      } catch (error) {
        lifecycleErrors.push(error);
      }
    }
  }

  if (primaryError || lifecycleErrors.length) {
    const message = [
      primaryError?.message,
      ...lifecycleErrors.map((error) => `cleanup/diagnostics failure: ${error.message}`),
    ]
      .filter(Boolean)
      .join("; ");
    const error = new Error(redactSecrets(message, sensitiveCanaries), {
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

async function executeSmokeOnly({
  workspace,
  diagnosticsDirectory,
  sourceEnvironment,
  corepackHome,
  signal,
}) {
  const temporaryHome = path.join(workspace, ".lmbg-home");
  await mkdir(temporaryHome, { recursive: true, mode: 0o700 });
  const environment = buildIsolatedGateEnvironment(
    sourceEnvironment,
    temporaryHome,
    corepackHome,
  );
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
    signal,
    terminationGraceMs: RESTART_SMOKE_TERMINATION_GRACE_MS,
  });
  return { status: "passed", mode: "smoke-only" };
}

async function executeGate() {
  const cancellation = createSignalAbortController();
  const smokeOnly = process.argv.includes("--smoke-only");
  const startedAt = Date.now();
  let diagnosticsDirectory;
  let callerIntegrity;
  let disposable;
  let result;
  let primaryError;
  const cleanupErrors = [];
  try {
    diagnosticsDirectory = await mkdtemp(
      path.join(os.tmpdir(), smokeOnly ? "context-router-smoke-run-" : "context-router-lmbg-"),
    );
    await chmod(diagnosticsDirectory, 0o700);
    callerIntegrity = await captureCallerIntegrity(callerIntegrityPaths);
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    let baseSha;
    let baseDirectory;
    let baseManifestSha256;
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
          signal: cancellation.signal,
        });
      }
      const baseBundle = await exportBaseContracts(baseSha, diagnosticsDirectory);
      baseDirectory = baseBundle.baseDirectory;
      baseManifestSha256 = baseBundle.manifestSha256;
    }
    disposable = await prepareDisposableWorkspace(
      diagnosticsDirectory,
      cancellation.signal,
    );
    result = smokeOnly
      ? await executeSmokeOnly({
          workspace: disposable.workspace,
          diagnosticsDirectory,
          sourceEnvironment: process.env,
          corepackHome: disposable.corepackHome,
          signal: cancellation.signal,
        })
      : await executeFullGate({
          workspace: disposable.workspace,
          diagnosticsDirectory,
          baseSha,
          baseDirectory,
          baseManifestSha256,
          sourceEnvironment: process.env,
          corepackHome: disposable.corepackHome,
          signal: cancellation.signal,
        });
  } catch (error) {
    primaryError = error;
  } finally {
    if (callerIntegrity) {
      try {
        await assertCallerIntegrity(callerIntegrity);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (disposable?.workspace) {
      try {
        await rm(disposable.workspace, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    cancellation.dispose();
  }

  if (primaryError || cleanupErrors.length) {
    const summary = primaryError?.gateSummary ?? {
      status: "failed",
      mode: smokeOnly ? "smoke-only" : "full",
    };
    summary.elapsedMs = Date.now() - startedAt;
    if (cancellation.signal.aborted) summary.status = "cancelled";
    summary.failure ??= primaryError
      ? { message: redactSecrets(primaryError.message), exitCode: primaryError.exitCode ?? 1 }
      : null;
    summary.cleanupErrors = cleanupErrors.map((error) => redactSecrets(error.message));
    if (diagnosticsDirectory) {
      try {
        await writeSanitizedJson(
          path.join(diagnosticsDirectory, "summary.json"),
          summary,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    const combined = [primaryError?.message, ...cleanupErrors.map((error) => `cleanup/integrity: ${error.message}`)]
      .filter(Boolean)
      .join("; ");
    console.error(`migration-gate: failed: ${redactSecrets(combined)}`);
    if (diagnosticsDirectory) {
      console.error(`migration-gate: sanitized diagnostics retained at ${diagnosticsDirectory}`);
    }
    process.exitCode = primaryError?.exitCode ??
      (cancellation.signal.reason?.message?.includes("SIGINT") ? 130 :
        cancellation.signal.reason?.message?.includes("SIGTERM") ? 143 : 1);
    return;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    smokeOnly
      ? `migration-smoke: ok; disposable caller-integrity=true elapsedMs=${elapsedMs}`
      : `migration-gate: ok; phases=${result.phases.length} baseComparison=${result.baseComparison} caller-integrity=true elapsedMs=${elapsedMs}`,
  );
  await rm(diagnosticsDirectory, { recursive: true, force: true });
}

export async function runWithToolchainPreflight(
  action = executeGate,
  { checkToolchain = checkCurrentToolchain } = {},
) {
  await checkToolchain();
  return action();
}

async function main() {
  try {
    await runWithToolchainPreflight();
  } catch (error) {
    const message =
      error?.message === TOOLCHAIN_ERROR_MESSAGE
        ? TOOLCHAIN_ERROR_MESSAGE
        : `migration-gate: failed before resource acquisition: ${redactSecrets(error?.message ?? error)}`;
    console.error(message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
