import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertCallerIntegrity,
  captureCallerIntegrity,
  combineFailures,
  copyWorkspaceFiles,
  runCommand,
} from "./gate-runner.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const expectedCatalogSha256 =
  "a86182cd8cace1281e236fd53b8c7df9a5b1be705e2fe3a5cf4e0989ea325e81";
const expectedCatalogByteLength = 4273;
const missingMessage = "Required preference catalog is missing";
const integrityMessage =
  "Required preference catalog failed integrity validation";
const operationalBudgetMs = 90_000;

function gitOutput(args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function callerStatus() {
  return gitOutput(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    "buffer",
  );
}

function disposableSourceFiles() {
  const output = gitOutput([
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z",
    "--",
    ".npmrc",
    ".nvmrc",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "scripts/check-toolchain.mjs",
    "apps/backend",
  ]);
  return output
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => !relativePath.includes("/node_modules/"))
    .filter((relativePath) => !relativePath.includes("/dist/"))
    .filter(
      (relativePath) => !relativePath.startsWith("apps/backend/src/generated/"),
    );
}

function strictEnvironment(privateHome) {
  const allowed = [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SHELL",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
  ];
  const environment = Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
  const originalHome = process.env.HOME ?? os.homedir();
  const corepackHome =
    process.env.COREPACK_HOME ??
    path.join(
      process.env.XDG_CACHE_HOME ?? path.join(originalHome, ".cache"),
      "node",
      "corepack",
    );
  const modules = readFileSyncUtf8(
    path.join(repositoryRoot, "node_modules/.modules.yaml"),
  );
  const storeDir = modules.match(/^storeDir:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(
    storeDir,
    "installed pnpm metadata must identify its offline store",
  );

  return {
    ...environment,
    HOME: privateHome,
    XDG_CONFIG_HOME: path.join(privateHome, ".config"),
    XDG_CACHE_HOME: path.join(privateHome, ".cache"),
    COREPACK_HOME: corepackHome,
    COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_NETWORK: "0",
    npm_config_offline: "true",
    npm_config_store_dir: storeDir,
    CI: "1",
    NO_COLOR: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL:
      "postgresql://runtime-resource-test:runtime-resource-test@127.0.0.1:1/runtime_resource_test",
  };
}

function readFileSyncUtf8(filePath) {
  return readFileSync(filePath, "utf8");
}

function assertStrictEnvironment(environment) {
  for (const forbidden of [
    "NODE_PATH",
    "NODE_OPTIONS",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GCP_PROJECT_ID",
    "VERTEX_REGION",
    "VERTEX_MODEL_ID",
    "AUTH0_CLIENT_SECRET",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ]) {
    assert.equal(
      forbidden in environment,
      false,
      `${forbidden} must be absent`,
    );
  }
  assert.equal(environment.COREPACK_ENABLE_NETWORK, "0");
}

async function recursivelyList(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relativePath = path.join(prefix, entry.name);
    result.push(relativePath);
    if (entry.isDirectory()) {
      result.push(...(await recursivelyList(root, relativePath)));
    }
  }
  return result.sort();
}

async function assertNoStageAncestorNodeModules(stageBackend, privateRoot) {
  const canonicalStageBackend = await realpath(stageBackend);
  const canonicalPrivateRoot = await realpath(privateRoot);
  let current = path.dirname(canonicalStageBackend);
  let foundPrivateRoot = false;
  while (true) {
    const candidate = path.join(current, "node_modules");
    const info = await lstat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert.equal(info, null, `stage ancestor owns node_modules: ${current}`);
    if (current === canonicalPrivateRoot) foundPrivateRoot = true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  assert.equal(foundPrivateRoot, true, "private root must be a stage ancestor");
}

async function assertPrivateDirectory(directory) {
  if (process.platform === "win32") return;
  assert.equal(
    (await stat(directory)).mode & 0o777,
    0o700,
    `${directory} must use mode 0700`,
  );
}

function runStagedMain(stageBackend, hostileCwd, environment) {
  const result = spawnSync(
    process.execPath,
    ["--no-global-search-paths", path.join(stageBackend, "dist/main.js")],
    {
      cwd: hostileCwd,
      env: {
        ...environment,
        NODE_ENV: "production",
        PORT: "0",
        APP_HOST: "127.0.0.1",
      },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  assert.equal(result.error?.code, undefined, result.error?.message);
  return {
    ...result,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function assertSanitizedFailure(result, expectedMessage, forbidden) {
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, new RegExp(expectedMessage));
  assert.doesNotMatch(result.output, /context-router\.backend\.ready/);
  assert.doesNotMatch(result.output, /Application is running on:/);
  for (const value of forbidden) {
    assert.equal(
      result.output.includes(value),
      false,
      `startup output leaked ${value}`,
    );
  }
}

async function containsBytes(root, needle) {
  for (const relativePath of await recursivelyList(root)) {
    if (
      relativePath === "node_modules" ||
      relativePath.startsWith(`node_modules${path.sep}`)
    ) {
      continue;
    }
    const absolutePath = path.join(root, relativePath);
    const info = await lstat(absolutePath);
    if (info.isFile() && (await readFile(absolutePath)).includes(needle)) {
      return relativePath;
    }
  }
  return null;
}

test("built backend resources and production dependencies are cwd-independent and closed", async () => {
  const startedAt = Date.now();
  const timings = {};
  const callerStatusBefore = callerStatus();
  const callerIntegrity = await captureCallerIntegrity(
    [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "apps/backend/package.json",
      "apps/backend/nest-cli.json",
      "apps/backend/tsconfig.json",
      "apps/backend/src",
      "apps/backend/dist",
    ].map((relativePath) => path.join(repositoryRoot, relativePath)),
  );
  let privateRoot;
  let primaryError;
  let cleanupError;
  let integrityError;

  const timed = async (name, operation) => {
    const start = Date.now();
    try {
      return await operation();
    } finally {
      timings[name] = Date.now() - start;
    }
  };

  try {
    const [
      rootPackage,
      backendPackage,
      workspace,
      lockfile,
      appModule,
      schemaResource,
    ] = await Promise.all(
      [
        "package.json",
        "apps/backend/package.json",
        "pnpm-workspace.yaml",
        "pnpm-lock.yaml",
        "apps/backend/src/app.module.ts",
        "apps/backend/src/mcp/resources/schema.resource.ts",
      ].map((relativePath) =>
        readFile(path.join(repositoryRoot, relativePath), "utf8"),
      ),
    );
    const rootManifest = JSON.parse(rootPackage);
    const backendManifest = JSON.parse(backendPackage);
    assert.equal(
      backendManifest.dependencies["@google-cloud/vertexai"],
      rootManifest.dependencies["@google-cloud/vertexai"],
    );
    assert.deepEqual(backendManifest.files, ["dist"]);
    assert.match(workspace, /^injectWorkspacePackages: true$/m);
    assert.match(
      lockfile,
      /^settings:\n(?:  .+\n)*  injectWorkspacePackages: true$/m,
    );
    assert.match(appModule, /autoSchemaFile:\s*true/);
    assert.doesNotMatch(appModule, /process\.cwd\(\)|schema\.gql/);
    assert.doesNotMatch(
      schemaResource,
      /process\.cwd\(\)|readFile|schema\.gql/,
    );

    const lexicalPrivateRoot = await mkdtemp(
      path.join(os.tmpdir(), "context-router-runtime-resources-"),
    );
    await chmod(lexicalPrivateRoot, 0o700);
    privateRoot = await realpath(lexicalPrivateRoot);
    assert.equal(await realpath(privateRoot), privateRoot);
    const sourceRoot = path.join(privateRoot, "source");
    const stageRoot = path.join(privateRoot, "stage");
    const stageBackend = path.join(stageRoot, "backend");
    const hostileCwd = path.join(privateRoot, "hostile-cwd");
    const privateHome = path.join(privateRoot, "home");
    for (const directory of [sourceRoot, stageRoot, hostileCwd, privateHome]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
    for (const directory of [
      privateRoot,
      sourceRoot,
      stageRoot,
      hostileCwd,
      privateHome,
    ]) {
      await assertPrivateDirectory(directory);
    }

    await timed("copySourceMs", () =>
      copyWorkspaceFiles(repositoryRoot, sourceRoot, disposableSourceFiles()),
    );
    await symlink(
      path.join(repositoryRoot, "node_modules"),
      path.join(sourceRoot, "node_modules"),
      "dir",
    );
    await symlink(
      path.join(repositoryRoot, "apps/backend/node_modules"),
      path.join(sourceRoot, "apps/backend/node_modules"),
      "dir",
    );

    const environment = strictEnvironment(privateHome);
    assertStrictEnvironment(environment);
    const controller = new AbortController();
    const deadline = setTimeout(
      () =>
        controller.abort(new Error("runtime resource proof budget exceeded")),
      75_000,
    );
    deadline.unref();
    try {
      await timed("prismaGenerateMs", () =>
        runCommand(["pnpm", "--filter", "backend", "prisma:generate"], {
          cwd: sourceRoot,
          env: environment,
          timeoutMs: 20_000,
          signal: controller.signal,
        }),
      );
      await timed("buildMs", () =>
        runCommand(["pnpm", "--filter", "backend", "build"], {
          cwd: sourceRoot,
          env: environment,
          timeoutMs: 35_000,
          signal: controller.signal,
        }),
      );

      const sourceCatalog = await readFile(
        path.join(
          sourceRoot,
          "apps/backend/src/config/preferences.catalog.json",
        ),
      );
      const builtCatalog = await readFile(
        path.join(
          sourceRoot,
          "apps/backend/dist/config/preferences.catalog.json",
        ),
      );
      assert.deepEqual(builtCatalog, sourceCatalog);
      assert.equal(
        createHash("sha256").update(builtCatalog).digest("hex"),
        expectedCatalogSha256,
      );

      const backendSource = path.join(sourceRoot, "apps/backend");
      const deployCanary = Buffer.from("deploy-payload-secret-canary");
      await Promise.all([
        writeFile(path.join(backendSource, ".env"), deployCanary, {
          mode: 0o600,
        }),
        writeFile(path.join(backendSource, ".env.local"), deployCanary, {
          mode: 0o600,
        }),
        writeFile(
          path.join(backendSource, "src/deploy-secret-canary.txt"),
          deployCanary,
          { mode: 0o600 },
        ),
        mkdir(path.join(backendSource, "test"), {
          recursive: true,
          mode: 0o700,
        }).then(() =>
          writeFile(
            path.join(backendSource, "test/deploy-secret-canary.txt"),
            deployCanary,
            { mode: 0o600 },
          ),
        ),
        writeFile(
          path.join(backendSource, "prisma/deploy-secret-canary.txt"),
          deployCanary,
          { mode: 0o600 },
        ),
      ]);

      await timed("deployMs", () =>
        runCommand(
          [
            "pnpm",
            "--offline",
            "--filter",
            "backend",
            "deploy",
            "--prod",
            stageBackend,
          ],
          {
            cwd: sourceRoot,
            env: environment,
            timeoutMs: 30_000,
            signal: controller.signal,
          },
        ),
      );
    } finally {
      clearTimeout(deadline);
    }

    assert.deepEqual((await readdir(stageBackend)).sort(), [
      "dist",
      "node_modules",
      "package.json",
      "pnpm-lock.yaml",
    ]);
    for (const forbidden of [".env", ".env.local", "src", "test", "prisma"]) {
      await assert.rejects(lstat(path.join(stageBackend, forbidden)), {
        code: "ENOENT",
      });
    }
    assert.equal(
      await containsBytes(
        stageBackend,
        Buffer.from("deploy-payload-secret-canary"),
      ),
      null,
    );
    const stagedManifest = JSON.parse(
      await readFile(path.join(stageBackend, "package.json"), "utf8"),
    );
    assert.equal(
      stagedManifest.dependencies["@google-cloud/vertexai"],
      "1.10.0",
    );
    await lstat(path.join(stageBackend, "node_modules/@google-cloud/vertexai"));
    for (const devOnly of ["@nestjs/testing", "typescript"]) {
      await assert.rejects(
        lstat(path.join(stageBackend, "node_modules", devOnly)),
        { code: "ENOENT" },
      );
    }

    await assertNoStageAncestorNodeModules(stageBackend, privateRoot);
    const stagedCatalogPath = path.join(
      stageBackend,
      "dist/config/preferences.catalog.json",
    );
    const trackedCatalog = await readFile(
      path.join(
        repositoryRoot,
        "apps/backend/src/config/preferences.catalog.json",
      ),
    );
    assert.deepEqual(await readFile(stagedCatalogPath), trackedCatalog);

    const resolutionScript = String.raw`
      const fs = require("fs");
      const path = require("path");
      const root = process.argv[1];
      const modulesRoot = fs.realpathSync(path.join(root, "node_modules"));
      const resolved = require.resolve("@google-cloud/vertexai", { paths: [root] });
      const resolvedReal = fs.realpathSync(resolved);
      const relative = path.relative(modulesRoot, resolvedReal);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Vertex SDK escaped staged node_modules");
      }
      require(path.join(root, "dist/app.module.js"));
      const adapter = require(path.join(root, "dist/infrastructure/vertex-ai/vertex-ai.service.js"));
      if (typeof adapter.VertexAiService !== "function") throw new Error("adapter did not load");
      const preflight = require(path.join(root, "dist/bootstrap/runtime-resource-preflight.js"));
      Promise.resolve(preflight.validateHostedRuntimeResources()).then(() => {
        process.stdout.write(JSON.stringify({ resolvedReal }));
      }).catch((error) => { throw error; });
    `;
    const resolution = spawnSync(
      process.execPath,
      ["--no-global-search-paths", "-e", resolutionScript, stageBackend],
      {
        cwd: hostileCwd,
        env: { ...environment, NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    assert.equal(
      resolution.status,
      0,
      `${resolution.stdout}\n${resolution.stderr}`,
    );
    const resolvedReal = JSON.parse(resolution.stdout).resolvedReal;
    const stageModulesReal = await realpath(
      path.join(stageBackend, "node_modules"),
    );
    assert.equal(
      path.relative(stageModulesReal, resolvedReal).startsWith(".."),
      false,
    );

    const goodCatalogPath = `${stagedCatalogPath}.owned-good`;
    await rename(stagedCatalogPath, goodCatalogPath);
    const missing = runStagedMain(stageBackend, hostileCwd, environment);
    assertSanitizedFailure(missing, missingMessage, [
      privateRoot,
      repositoryRoot,
      "preferences.catalog.json",
      "ENOENT",
      "Cannot find module",
      "expected-hash",
      "actual-hash",
    ]);
    await rename(goodCatalogPath, stagedCatalogPath);

    const tamperCanary = "valid-json-catalog-content-secret-canary";
    const tamperedBytes = Buffer.from(
      JSON.stringify({ tamperCanary }).padEnd(expectedCatalogByteLength, " "),
    );
    assert.equal(tamperedBytes.length, expectedCatalogByteLength);
    await rename(stagedCatalogPath, goodCatalogPath);
    try {
      await writeFile(stagedCatalogPath, tamperedBytes, {
        mode: 0o600,
        flag: "wx",
      });
      const tampered = runStagedMain(stageBackend, hostileCwd, environment);
      assertSanitizedFailure(tampered, integrityMessage, [
        privateRoot,
        repositoryRoot,
        "preferences.catalog.json",
        tamperCanary,
        "Unexpected token",
        expectedCatalogSha256,
        "expected-hash",
        "actual-hash",
      ]);
    } finally {
      await rm(stagedCatalogPath, { force: true });
      await rename(goodCatalogPath, stagedCatalogPath);
    }

    assert.deepEqual(await readdir(hostileCwd), []);
    await assert.rejects(lstat(path.join(hostileCwd, "src/schema.gql")), {
      code: "ENOENT",
    });
  } catch (error) {
    primaryError = error;
  }

  const cleanupStartedAt = Date.now();
  if (privateRoot) {
    try {
      await rm(privateRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error;
    }
  }
  timings.cleanupMs = Date.now() - cleanupStartedAt;
  try {
    await assertCallerIntegrity(callerIntegrity);
    assert.deepEqual(callerStatus(), callerStatusBefore);
  } catch (error) {
    integrityError = error;
  }
  const elapsedMs = Date.now() - startedAt;
  timings.elapsedMs = elapsedMs;
  const budgetError =
    elapsedMs < operationalBudgetMs
      ? undefined
      : new Error(
          `runtime resource proof exceeded ${operationalBudgetMs}ms: ${JSON.stringify(timings)}`,
        );
  const combined = combineFailures(
    primaryError,
    [cleanupError, integrityError, budgetError],
    "runtime resource proof",
  );
  if (combined) throw combined;
});
