import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCallerIntegrity,
  captureCallerIntegrity,
  createResourceLifecycleJournal,
  isProcessLive,
} from "./gate-runner.mjs";

import {
  BACKEND_DEPLOY_ARGV_PREFIX,
  PACKAGING_CHILD_COMMAND_IDS,
  PACKAGED_SMOKE_TERMINATION_GRACE_MS,
  assertCompletedLifecycle,
  assertNoCanaryLeak,
  assertNoSharedRegularFiles,
  assertApprovedPackagingChildCommand,
  assertPackageResolutionWithinRoot,
  assertPackagingDiagnosticsOwnership,
  assertPackagingPrivateRootOwnership,
  buildBackendDeployArgv,
  approvedPackagingChildArgv,
  buildPackagedRuntimeEnvironment,
  classifyNegativeProbe,
  collectDarwinListenerEvidence,
  collectListenerIsolationEvidence,
  createPackagingPrivateRoot,
  createSanitizedPackagingError,
  createStableLoopbackProxy,
  createWebAttemptLifecycleHooks,
  deriveStandaloneLayout,
  diagnosticContents,
  directCallerIntegrityPaths,
  enumerateNonLoopbackProbeTargets,
  finalizePackagingSmokeEvidence,
  formatNetworkProbeHost,
  parseBackendReadinessLine,
  parseDarwinLsofListenerRows,
  preparePackagingDiagnosticsDirectory,
  requireTcpConnection,
  sanitizeDiagnostics,
  sealAndDescribeStage,
  startManagedChild,
  startWebWithAddressRetry,
  stopManagedChild,
  verifyGateWorkspaceOwnership,
  verifySealedStage,
  waitWithTimeout,
  withPrivateFileCreationMask,
} from "./packaging-smoke.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function temporaryDirectory(prefix, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await operation(directory);
  } finally {
    async function makeWritable(candidate) {
      const info = await lstat(candidate).catch(() => null);
      if (!info || info.isSymbolicLink()) return;
      if (info.isDirectory()) {
        await chmod(candidate, 0o700).catch(() => {});
        for (const name of await readdir(candidate).catch(() => [])) {
          await makeWritable(path.join(candidate, name));
        }
      } else if (info.isFile()) {
        await chmod(candidate, 0o600).catch(() => {});
      }
    }
    await makeWritable(directory);
    await rm(directory, { recursive: true, force: true });
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("Next standalone configuration is module-relative and derives apps/web", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "apps/web/next.config.ts"),
    "utf8",
  );
  assert.match(source, /output:\s*["']standalone["']/);
  assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
  assert.doesNotMatch(source, /process\.cwd\(/);

  const layout = deriveStandaloneLayout({
    repositoryRoot: "/private/source",
    webRoot: "/private/source/apps/web",
    stageRoot: "/private/stage",
  });
  assert.deepEqual(layout, {
    appRelativePath: "apps/web",
    standaloneRoot: "/private/source/apps/web/.next/standalone",
    stagedWebRoot: "/private/stage/web",
    stagedAppRoot: "/private/stage/web/apps/web",
    serverEntrypoint: "/private/stage/web/apps/web/server.js",
  });
  assert.throws(
    () =>
      deriveStandaloneLayout({
        repositoryRoot: "/private/source",
        webRoot: "/private/other/web",
        stageRoot: "/private/stage",
      }),
    /apps\/web/,
  );
});

test("aggregate gate workspace ownership requires matching durable records", async () => {
  await temporaryDirectory("packaging-gate-ownership-test-", async (root) => {
    const canonicalRoot = await realpath(root);
    const workspace = path.join(canonicalRoot, "workspace");
    const workspaceMarkerPath = path.join(
      workspace,
      ".git",
      "lmbg-workspace-owner.json",
    );
    const ownershipMarkerPath = path.join(
      canonicalRoot,
      "workspace-ownership.json",
    );
    const corepackHome = path.join(canonicalRoot, "corepack-home");
    await mkdir(path.dirname(workspaceMarkerPath), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(corepackHome, { mode: 0o700 });
    const workspaceInfo = await lstat(workspace);
    const ownershipMarker = "a".repeat(48);
    const workspaceMarker = {
      schemaVersion: 1,
      workspace,
      ownershipMarker,
      device: String(workspaceInfo.dev),
      inode: String(workspaceInfo.ino),
    };
    const ownershipRecord = {
      schemaVersion: 1,
      workspace,
      ownershipMarker,
      ownershipMarkerPath,
      workspaceMarkerPath,
      device: workspaceMarker.device,
      inode: workspaceMarker.inode,
    };
    const environment = {
      MIGRATION_PACKAGING_GATE_WORKSPACE: workspace,
      MIGRATION_PACKAGING_GATE_OWNERSHIP_MARKER: ownershipMarker,
      MIGRATION_PACKAGING_GATE_OWNERSHIP_FILE: ownershipMarkerPath,
      MIGRATION_PACKAGING_COREPACK_HOME: corepackHome,
    };
    const writePrivateJson = (filePath, value) =>
      writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });

    await writePrivateJson(workspaceMarkerPath, workspaceMarker);
    await writePrivateJson(ownershipMarkerPath, ownershipRecord);
    assert.deepEqual(
      await verifyGateWorkspaceOwnership(workspace, environment),
      {
        workspace,
        marker: ownershipMarker,
        markerPath: ownershipMarkerPath,
        corepackHome,
      },
    );

    await writePrivateJson(workspaceMarkerPath, {
      ...workspaceMarker,
      ownershipMarker: "b".repeat(48),
    });
    await assert.rejects(
      verifyGateWorkspaceOwnership(workspace, environment),
      /workspace ownership did not verify/,
    );
    await writePrivateJson(workspaceMarkerPath, workspaceMarker);

    await rm(workspaceMarkerPath);
    await assert.rejects(
      verifyGateWorkspaceOwnership(workspace, environment),
      /workspace ownership did not verify/,
    );
    await writePrivateJson(workspaceMarkerPath, workspaceMarker);

    await writePrivateJson(ownershipMarkerPath, {
      ...ownershipRecord,
      ownershipMarkerPath: path.join(canonicalRoot, "replacement.json"),
    });
    await assert.rejects(
      verifyGateWorkspaceOwnership(workspace, environment),
      /ownership record did not verify/,
    );
    await writePrivateJson(ownershipMarkerPath, {
      ...ownershipRecord,
      workspaceMarkerPath: path.join(workspace, ".git", "replacement.json"),
    });
    await assert.rejects(
      verifyGateWorkspaceOwnership(workspace, environment),
      /ownership record did not verify/,
    );
  });
});

test("diagnostic sanitation preserves lifecycle controls under colliding canaries", async () => {
  await temporaryDirectory("packaging-lifecycle-redaction-test-", async (root) => {
    const canaries = [
      "admin",
      "database",
      "passed",
      "postgres",
      "1",
      "true",
      "null",
    ];
    const journal = await createResourceLifecycleJournal(root, { canaries });
    await journal.acquiring({
      id: "administration",
      type: "external-administration",
      owned: false,
      identity: { source: "admin database passed postgres" },
      recovery: "admin database passed postgres",
    });
    await journal.acquired("administration");
    await journal.cleanupFinished("administration", {
      status: "not-owned",
    });
    await journal.acquiring({
      id: "database",
      type: "owned-test-database",
      owned: true,
      identity: {
        value: "admin database passed postgres",
        generation: 1,
        ready: true,
        optional: null,
      },
      recovery: "admin database passed postgres",
    });
    await journal.acquired("database");
    await journal.cleanupFinished("database", { status: "removed" });
    await journal.finish("passed");

    await sanitizeDiagnostics(root, canaries);
    const persisted = JSON.parse(await readFile(journal.filePath, "utf8"));
    assert.equal(persisted.status, "passed");
    assert.deepEqual(
      persisted.resources.map(({ id, type, status, cleanup }) => ({
        id,
        type,
        status,
        cleanup: cleanup.status,
      })),
      [
        {
          id: "administration",
          type: "external-administration",
          status: "acquired",
          cleanup: "not-owned",
        },
        {
          id: "database",
          type: "owned-test-database",
          status: "acquired",
          cleanup: "removed",
        },
      ],
    );
    assert.equal(persisted.resources[1].identity.generation, 1);
    assert.equal(persisted.resources[1].identity.ready, true);
    assert.equal(persisted.resources[1].identity.optional, null);
    const inspectionValues = await diagnosticContents(root);
    assert.doesNotThrow(() =>
      assertNoCanaryLeak(inspectionValues, canaries),
    );
  });
});

test("packaging operations create private files and restore the caller umask", async () => {
  const before = process.umask();
  assert.equal(
    await withPrivateFileCreationMask(async () => {
      assert.equal(process.umask(), 0o077);
      return "private";
    }),
    "private",
  );
  assert.equal(process.umask(), before);
  await assert.rejects(
    withPrivateFileCreationMask(async () => {
      assert.equal(process.umask(), 0o077);
      throw new Error("forced private operation failure");
    }),
    /forced private operation failure/,
  );
  assert.equal(process.umask(), before);
});

test("backend deploy command policy permits exactly one offline production target", () => {
  assert.deepEqual(BACKEND_DEPLOY_ARGV_PREFIX, [
    "pnpm",
    "--offline",
    "--filter",
    "backend",
    "deploy",
    "--prod",
  ]);
  assert.deepEqual(buildBackendDeployArgv("/private/stage/backend"), [
    ...BACKEND_DEPLOY_ARGV_PREFIX,
    "/private/stage/backend",
  ]);
  assert.throws(
    () => buildBackendDeployArgv("relative/backend"),
    /absolute/,
  );

  const context = {
    repositoryRoot: "/private/repository",
    sourceRoot: "/private/source",
    stageBackend: "/private/stage/backend",
  };
  for (const id of PACKAGING_CHILD_COMMAND_IDS) {
    const argv = approvedPackagingChildArgv(id, context);
    assert.deepEqual(
      assertApprovedPackagingChildCommand(id, argv, context),
      argv,
    );
  }
  const rejected = [
    ["pnpm", "--filter", "backend", "deploy", "--prod", context.stageBackend],
    ["pnpm", "install", "--frozen-lockfile"],
    ["npm", "install"],
    [...buildBackendDeployArgv(context.stageBackend), "--extra-materializer"],
    ["curl", "https://packages.invalid/archive.tgz"],
    ["node", "scripts/contact-live-provider.mjs"],
  ];
  for (const argv of rejected) {
    assert.throws(
      () => assertApprovedPackagingChildCommand("backend-deploy", argv, context),
      /does not match its allowlist/,
    );
  }
  assert.throws(
    () => assertApprovedPackagingChildCommand("second-materializer", [], context),
    /unapproved packaging child command id/,
  );
});

test("packaging tools force copied pnpm imports and staged Node disables global search", async () => {
  const packaging = await import("./packaging-smoke.mjs");
  assert.equal(typeof packaging.strictToolEnvironment, "function");
  assert.equal(typeof packaging.buildPackagedNodeArgv, "function");
  const environment = packaging.strictToolEnvironment(
    { PATH: "/usr/bin", AUTH0_CLIENT_SECRET: "must-not-pass-through" },
    {
      home: "/private/tool-home",
      corepackHome: "/private/corepack",
      storeRoot: "/private/pnpm-store",
      proxyOrigin: "http://127.0.0.1:4100",
    },
  );
  assert.equal(environment.npm_config_package_import_method, "copy");
  assert.equal(environment.npm_config_offline, "true");
  assert.equal(
    environment.AUTH0_CLIENT_SECRET,
    "synthetic-migration-gate-secret",
  );
  assert.notEqual(environment.AUTH0_CLIENT_SECRET, "must-not-pass-through");
  assert.deepEqual(
    packaging.buildPackagedNodeArgv("/private/stage/server.js"),
    ["--no-global-search-paths", "/private/stage/server.js"],
  );
  assert.throws(
    () => packaging.buildPackagedNodeArgv("relative/server.js"),
    /absolute/,
  );
});

test("every packaging subprocess has materializer policy or a reviewed helper census", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "scripts/local-migration/packaging-smoke.mjs"),
    "utf8",
  );
  const ids = [
    ...source.matchAll(
      /assertApprovedPackagingChildCommand\(\s*"([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(ids.sort(), [...PACKAGING_CHILD_COMMAND_IDS].sort());
  assert.equal(
    [...source.matchAll(/\brunCommand\s*\(/g)].length,
    PACKAGING_CHILD_COMMAND_IDS.length,
    "a packaging runCommand callsite bypassed the exact command policy",
  );

  assert.match(
    source,
    /import \{ execFile, spawn \} from "node:child_process";/,
  );
  assert.equal(
    [...source.matchAll(/node:child_process/g)].length,
    2,
    "only the smoke runner and its embedded orphan-process fixture may import child_process",
  );
  assert.match(source, /'import \{ spawn \} from "node:child_process";'/);
  assert.equal([...source.matchAll(/\bexecFile\s*\(/g)].length, 0);
  assert.equal([...source.matchAll(/\bexecFileAsync\s*\(/g)].length, 2);
  assert.match(source, /const result = await execFileAsync\("git", args, \{/);
  assert.match(source, /execFileAsync\(executable, args, options\);/);
  assert.equal([...source.matchAll(/\bspawn\s*\(/g)].length, 2);
  assert.match(
    source,
    /const child = spawn\(process\.execPath, buildPackagedNodeArgv\(entrypoint\), \{/,
  );
  assert.match(
    source,
    /const child = spawn\(process\.execPath, \[new URL\("\.\/grandchild\.mjs"/,
  );

  const restartSource = await readFile(
    path.join(repositoryRoot, "scripts/local-migration/restart-smoke.mjs"),
    "utf8",
  );
  const tlsStart = restartSource.indexOf(
    "export async function createTlsFixture",
  );
  const tlsEnd = restartSource.indexOf(
    "export async function startJwksFixture",
    tlsStart,
  );
  assert.ok(tlsStart >= 0 && tlsEnd > tlsStart);
  const tlsSource = restartSource.slice(tlsStart, tlsEnd);
  assert.equal([...tlsSource.matchAll(/\brunCommand\s*\(/g)].length, 3);
  assert.deepEqual(
    [...tlsSource.matchAll(/"openssl", "(req|x509)"/g)].map(
      (match) => match[1],
    ),
    ["req", "req", "x509"],
  );

  const databaseSource = await readFile(
    path.join(repositoryRoot, "scripts/local-migration/test-database.mjs"),
    "utf8",
  );
  const administrationStart = databaseSource.indexOf(
    "export async function prepareTestAdministration",
  );
  assert.ok(administrationStart >= 0);
  const administrationSource = databaseSource.slice(administrationStart);
  assert.equal(
    [...administrationSource.matchAll(/\bcommandRunner\s*\(/g)].length,
    5,
  );
  for (const fragment of [
    '"context", "inspect", "default"',
    '"image", "inspect", image',
    '"container",\n          "inspect"',
    '"rm", "--force", containerId',
    '"run",\n          "--pull=never"',
  ]) {
    assert.ok(
      administrationSource.includes(fragment),
      `missing reviewed Docker helper command fragment: ${fragment}`,
    );
  }
});

test("direct caller integrity covers ignored outputs and every copied input tree", async () => {
  await temporaryDirectory("packaging-direct-integrity-test-", async (root) => {
    const storeRoot = path.join(root, "pnpm-store");
    const sourceCorepack = path.join(root, "source-corepack");
    const expectedRelative = [
      "node_modules",
      "apps/backend/node_modules",
      "apps/web/node_modules",
      "apps/local-orchestrator/node_modules",
      "apps/backend/dist",
      "apps/web/.next",
      "apps/backend/src/generated/prisma",
      "apps/web/lib/generated",
    ];
    for (const relative of [...expectedRelative, "dirty.txt"]) {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      if (path.extname(target)) await writeFile(target, "sentinel\n");
      else {
        await mkdir(target, { recursive: true });
        await writeFile(path.join(target, "sentinel"), "unchanged\n");
      }
    }
    for (const target of [storeRoot, sourceCorepack]) {
      await mkdir(target);
      await writeFile(path.join(target, "sentinel"), "unchanged\n");
    }
    const paths = directCallerIntegrityPaths({
      repositoryRoot: root,
      presentFiles: ["dirty.txt"],
      storeRoot,
      sourceCorepack,
    });
    for (const relative of expectedRelative) {
      assert.ok(paths.includes(path.join(root, relative)));
    }
    assert.ok(paths.includes(storeRoot));
    assert.ok(paths.includes(sourceCorepack));
    const snapshot = await captureCallerIntegrity(paths);
    await writeFile(path.join(root, "apps/backend/dist/sentinel"), "mutated\n");
    await assert.rejects(assertCallerIntegrity(snapshot), /apps\/backend\/dist/);
  });
});

test("diagnostics require a newly owned directory and never adopt existing content", async () => {
  await temporaryDirectory("packaging-diagnostics-ownership-test-", async (root) => {
    const existing = path.join(root, "existing");
    const sentinel = path.join(existing, "sentinel.txt");
    await mkdir(existing);
    await writeFile(sentinel, "untouched\n", { mode: 0o644 });
    await assert.rejects(
      preparePackagingDiagnosticsDirectory(existing),
      /must be a new directory owned by this run/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "untouched\n");
    assert.equal((await stat(sentinel)).mode & 0o777, 0o644);

    const symlinkPath = path.join(root, "linked");
    await symlink(existing, symlinkPath);
    await assert.rejects(
      preparePackagingDiagnosticsDirectory(symlinkPath),
      /must be a new directory owned by this run/,
    );

    const protectedRoot = path.join(root, "protected");
    await mkdir(protectedRoot);
    const protectedDiagnostics = path.join(protectedRoot, "diagnostics");
    await assert.rejects(
      preparePackagingDiagnosticsDirectory(protectedDiagnostics, {
        protectedRoots: [protectedRoot],
      }),
      /outside repository, dependency, and store roots/,
    );
    await assert.rejects(lstat(protectedDiagnostics), /ENOENT/);
    const protectedAlias = path.join(root, "protected-alias");
    await symlink(protectedRoot, protectedAlias);
    await assert.rejects(
      preparePackagingDiagnosticsDirectory(
        path.join(protectedAlias, "through-symlink"),
        { protectedRoots: [protectedRoot] },
      ),
      /outside repository, dependency, and store roots/,
    );
    assert.deepEqual(await readdir(protectedRoot), []);

    const owned = await preparePackagingDiagnosticsDirectory(
      path.join(root, "new-diagnostics"),
    );
    assert.equal(
      await assertPackagingDiagnosticsOwnership(owned),
      await realpath(owned.directory),
    );
    await writeFile(
      owned.markerPath,
      `${JSON.stringify({ schemaVersion: 1, directory: owned.directory, nonce: "wrong" })}\n`,
    );
    await assert.rejects(
      assertPackagingDiagnosticsOwnership(owned),
      /marker did not verify/,
    );
  });
});

test("diagnostics allocation rolls back when private preparation fails", async () => {
  await temporaryDirectory("packaging-diagnostics-rollback-test-", async (root) => {
    const requested = path.join(root, "diagnostics");
    await assert.rejects(
      preparePackagingDiagnosticsDirectory(requested, {
        async setPrivateMode() {
          throw new Error("injected diagnostics chmod failure");
        },
      }),
      /injected diagnostics chmod failure/,
    );
    await assert.rejects(lstat(requested), /ENOENT/);
  });
});

test("private packaging roots persist verifiable recovery identity immediately", async () => {
  await temporaryDirectory("packaging-private-root-test-", async (root) => {
    const protectedRoot = path.join(root, "protected");
    await mkdir(protectedRoot);
    await assert.rejects(
      createPackagingPrivateRoot(
        path.join(protectedRoot, "owned-"),
        async () => {},
        { protectedRoots: [protectedRoot] },
      ),
      /outside repository, dependency, and store roots/,
    );
    assert.deepEqual(await readdir(protectedRoot), []);

    const diagnostics = path.join(root, "diagnostics");
    await mkdir(diagnostics, { mode: 0o700 });
    const journal = await createResourceLifecycleJournal(diagnostics);
    await journal.acquiring({
      id: "private-root",
      type: "packaging-private-root",
      owned: true,
      identity: {},
      recovery: "remove only the exact recorded root",
    });
    let callbackOwnership;
    const ownership = await createPackagingPrivateRoot(
      path.join(root, "owned-"),
      async (created) => {
        callbackOwnership = created;
        await journal.acquired("private-root", {
          identity: {
            path: created.directory,
            markerPath: created.markerPath,
            nonce: created.nonce,
            mode: "preparing",
          },
        });
        const persisted = JSON.parse(await readFile(journal.filePath, "utf8"));
        assert.deepEqual(persisted.resources[0].identity, {
          path: created.directory,
          markerPath: created.markerPath,
          nonce: created.nonce,
          mode: "preparing",
        });
        await assert.rejects(lstat(created.markerPath), /ENOENT/);
      },
    );
    assert.deepEqual(callbackOwnership, ownership);
    assert.match(ownership.nonce, /^[a-f0-9]{48}$/);
    assert.equal(
      await assertPackagingPrivateRootOwnership(ownership),
      ownership.directory,
    );
    await writeFile(
      ownership.markerPath,
      `${JSON.stringify({ schemaVersion: 1, directory: ownership.directory, nonce: "wrong" })}\n`,
    );
    await assert.rejects(
      assertPackagingPrivateRootOwnership(ownership),
      /marker did not verify/,
    );
  });
});

test("private packaging root allocation rolls back when ownership handoff fails", async () => {
  await temporaryDirectory("packaging-private-root-rollback-test-", async (root) => {
    let allocated;
    let rollbackError;
    const diagnostics = path.join(root, "diagnostics");
    await mkdir(diagnostics);
    const journal = await createResourceLifecycleJournal(diagnostics);
    await journal.acquiring({
      id: "private-root",
      type: "packaging-private-root",
      owned: true,
      identity: {},
      recovery: "remove exact root",
    });
    await assert.rejects(
      createPackagingPrivateRoot(path.join(root, "owned-"), async (ownership) => {
        allocated = ownership.directory;
        await journal.acquired("private-root", {
          identity: { path: ownership.directory, nonce: ownership.nonce },
        });
        throw new Error("injected ownership handoff failure");
      }),
      (error) => {
        rollbackError = error;
        return /injected ownership handoff failure/.test(error.message);
      },
    );
    assert.equal(rollbackError.allocationRolledBack, true);
    assert.equal(rollbackError.ownership.directory, allocated);
    await assert.rejects(lstat(allocated), /ENOENT/);
    await journal.cleanupFinished("private-root", { status: "removed" });
    const resource = journal.state.resources[0];
    assert.equal(resource.cleanup.status, "removed");
    assert.equal(resource.recoveryRequired, false);
    assert.deepEqual((await readdir(root)).sort(), ["diagnostics"]);
  });
});

test("late packaging evidence validation downgrades summary and lifecycle to failed", async () => {
  await temporaryDirectory("packaging-finalizer-validation-test-", async (root) => {
    const ownership = await preparePackagingDiagnosticsDirectory(
      path.join(root, "diagnostics"),
    );
    const journal = await createResourceLifecycleJournal(ownership.directory);
    const cleanupErrors = [];
    const summary = { schemaVersion: 1, status: "passed" };
    await finalizePackagingSmokeEvidence({
      diagnostics: ownership.directory,
      diagnosticsOwnership: ownership,
      ownsDiagnostics: false,
      summary,
      journal,
      primaryError: null,
      cleanupErrors,
      signal: undefined,
      canaries: [],
      validateLifecycle() {
        throw new Error("injected late lifecycle validation failure");
      },
    });
    const persistedSummary = JSON.parse(
      await readFile(path.join(ownership.directory, "summary.json"), "utf8"),
    );
    const persistedLifecycle = JSON.parse(await readFile(journal.filePath, "utf8"));
    assert.equal(summary.status, "failed");
    assert.equal(persistedSummary.status, "failed");
    assert.equal(persistedLifecycle.status, "failed");
    assert.match(cleanupErrors[0].message, /injected late lifecycle/);
  });
});

test("packaging evidence treats cancellation without another failure as terminal", async () => {
  await temporaryDirectory("packaging-finalizer-cancel-test-", async (root) => {
    const ownership = await preparePackagingDiagnosticsDirectory(
      path.join(root, "diagnostics"),
    );
    const journal = await createResourceLifecycleJournal(ownership.directory);
    const cleanupErrors = [];
    const summary = { schemaVersion: 1, status: "running" };
    const controller = new AbortController();
    controller.abort(new Error("injected packaging cancellation"));
    await finalizePackagingSmokeEvidence({
      diagnostics: ownership.directory,
      diagnosticsOwnership: ownership,
      ownsDiagnostics: false,
      summary,
      journal,
      primaryError: null,
      cleanupErrors,
      signal: controller.signal,
      canaries: [],
    });
    const persistedSummary = JSON.parse(
      await readFile(path.join(ownership.directory, "summary.json"), "utf8"),
    );
    const persistedLifecycle = JSON.parse(await readFile(journal.filePath, "utf8"));
    assert.equal(summary.status, "cancelled");
    assert.equal(persistedSummary.status, "cancelled");
    assert.equal(persistedLifecycle.status, "cancelled");
    assert.match(cleanupErrors[0].message, /injected packaging cancellation/);
  });
});

test("retained packaging evidence never publishes pass before lifecycle finalization", async () => {
  await temporaryDirectory("packaging-finalizer-order-test-", async (root) => {
    const ownership = await preparePackagingDiagnosticsDirectory(
      path.join(root, "diagnostics"),
    );
    const baseJournal = await createResourceLifecycleJournal(ownership.directory);
    const cleanupErrors = [];
    const summary = { schemaVersion: 1, status: "running" };
    let statusObservedInsideFinish;
    const journal = {
      ...baseJournal,
      async finish() {
        statusObservedInsideFinish = JSON.parse(
          await readFile(path.join(ownership.directory, "summary.json"), "utf8"),
        ).status;
        throw new Error("injected lifecycle finalization failure");
      },
    };
    await finalizePackagingSmokeEvidence({
      diagnostics: ownership.directory,
      diagnosticsOwnership: ownership,
      ownsDiagnostics: false,
      summary,
      journal,
      primaryError: null,
      cleanupErrors,
      signal: undefined,
      canaries: [],
    });
    const persistedSummary = JSON.parse(
      await readFile(path.join(ownership.directory, "summary.json"), "utf8"),
    );
    assert.equal(summary.status, "failed");
    assert.equal(statusObservedInsideFinish, "running");
    assert.notEqual(persistedSummary.status, "passed");
    assert.match(cleanupErrors[0].message, /lifecycle finalization failure/);
  });
});

test("automatic diagnostics removal never leaves pass evidence or adopts an unverified tree", async () => {
  await temporaryDirectory("packaging-finalizer-removal-test-", async (root) => {
    const ownership = await preparePackagingDiagnosticsDirectory(
      path.join(root, "diagnostics"),
    );
    const journal = await createResourceLifecycleJournal(ownership.directory);
    const cleanupErrors = [];
    const summary = { schemaVersion: 1, status: "passed" };
    await finalizePackagingSmokeEvidence({
      diagnostics: ownership.directory,
      diagnosticsOwnership: ownership,
      ownsDiagnostics: true,
      summary,
      journal,
      primaryError: null,
      cleanupErrors,
      signal: undefined,
      canaries: [],
      async removeDiagnostics() {
        await rm(ownership.markerPath);
        throw new Error("injected partial diagnostics removal failure");
      },
    });
    const persistedSummary = JSON.parse(
      await readFile(path.join(ownership.directory, "summary.json"), "utf8"),
    );
    const persistedLifecycle = JSON.parse(await readFile(journal.filePath, "utf8"));
    assert.equal(summary.status, "failed");
    assert.notEqual(persistedSummary.status, "passed");
    assert.equal(
      persistedSummary.cleanupPending,
      "automatic-diagnostics-removal",
    );
    assert.notEqual(persistedLifecycle.status, "passed");
    await assert.rejects(lstat(ownership.markerPath), /ENOENT/);
    assert.equal((await stat(ownership.directory)).isDirectory(), true);
    assert.match(cleanupErrors[0].message, /injected partial diagnostics removal/);
  });
});

test("automatic diagnostics removal reports cancellation and whether evidence remains", async () => {
  await temporaryDirectory("packaging-finalizer-removal-cancel-test-", async (root) => {
    const ownership = await preparePackagingDiagnosticsDirectory(
      path.join(root, "diagnostics"),
    );
    const journal = await createResourceLifecycleJournal(ownership.directory);
    const cleanupErrors = [];
    const summary = { schemaVersion: 1, status: "running" };
    const controller = new AbortController();
    const finalization = await finalizePackagingSmokeEvidence({
      diagnostics: ownership.directory,
      diagnosticsOwnership: ownership,
      ownsDiagnostics: true,
      summary,
      journal,
      primaryError: null,
      cleanupErrors,
      signal: controller.signal,
      canaries: [],
      async removeDiagnostics(directory) {
        await rm(directory, { recursive: true, force: true });
        controller.abort(new Error("injected cancellation during removal"));
      },
    });
    assert.equal(summary.status, "cancelled");
    assert.equal(finalization.completionCommitted, false);
    assert.equal(finalization.diagnosticsRetained, false);
    assert.match(cleanupErrors[0].message, /cancellation during removal/);
  });
});

test("sealed stage inventory excludes only its manifest and external hashes cover final modes", async () => {
  await temporaryDirectory("packaging-stage-test-", async (root) => {
    const stageRoot = path.join(root, "stage");
    await mkdir(path.join(stageRoot, "backend", "dist"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(path.join(stageRoot, "web", "apps", "web"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      path.join(stageRoot, "backend", "dist", "main.js"),
      "console.log('backend');\n",
      { mode: 0o600 },
    );
    for (const name of ["a.txt", "_.txt", "B.txt", "@.txt"]) {
      await writeFile(
        path.join(stageRoot, "backend", "dist", name),
        `${name}\n`,
        { mode: 0o600 },
      );
    }
    await writeFile(
      path.join(stageRoot, "web", "apps", "web", "server.js"),
      "console.log('web');\n",
      { mode: 0o600 },
    );
    await symlink(
      "dist/main.js",
      path.join(stageRoot, "backend", "entrypoint.js"),
    );

    const sealed = await sealAndDescribeStage(stageRoot, {
      schemaVersion: 1,
      appRelativePath: "apps/web",
      serverEntrypoint: "web/apps/web/server.js",
      publicPresent: false,
    });
    assert.deepEqual(sealed.manifest.inventoryExcludes, ["manifest.json"]);
    assert.equal(
      sealed.manifest.inventory.some(({ path: entry }) => entry === "manifest.json"),
      false,
    );
    assert.deepEqual(
      sealed.manifest.inventory.map(({ path: entry }) => entry),
      [
        "backend",
        "backend/dist",
        "backend/dist/@.txt",
        "backend/dist/B.txt",
        "backend/dist/_.txt",
        "backend/dist/a.txt",
        "backend/dist/main.js",
        "backend/entrypoint.js",
        "web",
        "web/apps",
        "web/apps/web",
        "web/apps/web/server.js",
      ],
    );
    assert.match(sealed.manifestSha256, /^[a-f0-9]{64}$/);
    assert.match(sealed.stageTreeSha256, /^[a-f0-9]{64}$/);
    assert.equal((await stat(stageRoot)).mode & 0o777, 0o555);
    assert.equal(
      (await stat(path.join(stageRoot, "manifest.json"))).mode & 0o777,
      0o444,
    );
    assert.equal(
      (await stat(path.join(stageRoot, "backend", "dist", "main.js"))).mode &
        0o777,
      0o444,
    );
    assert.deepEqual(await verifySealedStage(stageRoot, sealed), sealed);

    await chmod(stageRoot, 0o755);
    await chmod(path.join(stageRoot, "backend"), 0o755);
    await chmod(path.join(stageRoot, "backend", "dist"), 0o755);
    await chmod(path.join(stageRoot, "backend", "dist", "main.js"), 0o644);
    await writeFile(
      path.join(stageRoot, "backend", "dist", "main.js"),
      "console.log('tampered');\n",
    );
    await assert.rejects(
      verifySealedStage(stageRoot, sealed),
      /stage integrity changed/,
    );
  });
});

test("stage sealing rejects escaping symlinks before writing a manifest", async () => {
  await temporaryDirectory("packaging-stage-link-test-", async (root) => {
    const stageRoot = path.join(root, "stage");
    await mkdir(path.join(stageRoot, "backend"), { recursive: true });
    await mkdir(path.join(stageRoot, "web"), { recursive: true });
    await symlink("../../outside", path.join(stageRoot, "backend", "escape"));
    await assert.rejects(
      sealAndDescribeStage(stageRoot, { schemaVersion: 1 }),
      /escapes the stage/,
    );
    await assert.rejects(
      lstat(path.join(stageRoot, "manifest.json")),
      (error) => error.code === "ENOENT",
    );
  });
});

test("stage sealing rejects dangling and chained escaping symlinks", async () => {
  await temporaryDirectory("packaging-stage-chain-test-", async (root) => {
    const stageRoot = path.join(root, "stage");
    await mkdir(path.join(stageRoot, "backend"), { recursive: true });
    await mkdir(path.join(stageRoot, "web"), { recursive: true });
    await writeFile(path.join(root, "outside"), "outside\n");
    await symlink("../../outside", path.join(stageRoot, "web", "outside-link"));
    await symlink("../web/outside-link", path.join(stageRoot, "backend", "chain"));
    await assert.rejects(
      sealAndDescribeStage(stageRoot, { schemaVersion: 1 }),
      /escapes the stage/,
    );

    await rm(path.join(stageRoot, "backend", "chain"));
    await rm(path.join(stageRoot, "web", "outside-link"));
    await symlink("missing", path.join(stageRoot, "backend", "dangling"));
    await assert.rejects(
      sealAndDescribeStage(stageRoot, { schemaVersion: 1 }),
      /dangling stage symlink/,
    );
  });
});

test("stage sealing refuses regular files hardlinked to mutable sources", async () => {
  await temporaryDirectory("packaging-stage-hardlink-test-", async (root) => {
    const sourceRoot = path.join(root, "source");
    const stageRoot = path.join(root, "stage");
    await mkdir(sourceRoot);
    await mkdir(path.join(stageRoot, "backend"), { recursive: true });
    await mkdir(path.join(stageRoot, "web"), { recursive: true });
    const sourceFile = path.join(sourceRoot, "artifact.js");
    await writeFile(sourceFile, "shared\n", { mode: 0o600 });
    await link(sourceFile, path.join(stageRoot, "backend", "artifact.js"));
    await assert.rejects(
      assertNoSharedRegularFiles(stageRoot, [sourceRoot]),
      /hardlink/,
    );
  });
});

test("native package resolution and its manifest must both stay in the staged web closure", async () => {
  await temporaryDirectory("packaging-native-closure-test-", async (root) => {
    const stage = path.join(root, "stage-web");
    const stagedPackage = path.join(stage, "node_modules", "sharp");
    const outsidePackage = path.join(root, "ancestor-node-modules", "sharp");
    await mkdir(stagedPackage, { recursive: true });
    await mkdir(outsidePackage, { recursive: true });
    for (const packageRoot of [stagedPackage, outsidePackage]) {
      await writeFile(path.join(packageRoot, "index.js"), "module.exports = {};\n");
      await writeFile(
        path.join(packageRoot, "package.json"),
        '{"name":"sharp","version":"1.0.0"}\n',
      );
    }
    await assert.doesNotReject(
      assertPackageResolutionWithinRoot(
        stage,
        path.join(stagedPackage, "index.js"),
        path.join(stagedPackage, "package.json"),
        "sharp",
      ),
    );
    await assert.rejects(
      assertPackageResolutionWithinRoot(
        stage,
        path.join(outsidePackage, "index.js"),
        path.join(outsidePackage, "package.json"),
        "sharp",
      ),
      /escaped the staged web closure/,
    );
    await assert.rejects(
      assertPackageResolutionWithinRoot(
        stage,
        path.join(stagedPackage, "index.js"),
        path.join(outsidePackage, "package.json"),
        "sharp",
      ),
      /escaped the staged web closure/,
    );
  });
});

test("packaged runtime environment is strict, private, loopback, and supports MCP fallback", () => {
  const fallback = buildPackagedRuntimeEnvironment(
    {
      PATH: "/bin",
      LANG: "en_US.UTF-8",
      HOME: "/caller/home",
      AUTH0_CLIENT_SECRET: "caller-secret",
      GOOGLE_APPLICATION_CREDENTIALS: "/caller/key.json",
    },
    {
      home: "/private/runtime/home",
      temp: "/private/runtime/tmp",
      proxyOrigin: "http://127.0.0.1:41001",
      webOrigin: "http://127.0.0.1:41002",
      databaseUrl: "postgresql://synthetic@127.0.0.1:5433/context_router_deadbeef_test",
      auth: {
        domain: "127.0.0.1:4443",
        issuer: "https://127.0.0.1:4443/",
        audience: "urn:synthetic",
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        sessionSecret: "synthetic-session-secret",
        caCertificate: "/private/secrets/ca.crt",
      },
    },
  );
  assert.equal(fallback.HOME, "/private/runtime/home");
  assert.equal(fallback.TMPDIR, "/private/runtime/tmp");
  assert.equal(fallback.APP_BASE_URL, "http://127.0.0.1:41002");
  assert.equal(fallback.MCP_SERVER_URL, "http://127.0.0.1:41001");
  assert.equal(fallback.APP_HOST, "127.0.0.1");
  assert.equal(fallback.AUTH0_SECRET, "synthetic-session-secret");
  assert.equal(fallback.AUTH0_ISSUER, "https://127.0.0.1:4443/");
  assert.equal(fallback.AUTH0_LEGACY_ISSUER, fallback.AUTH0_ISSUER);
  assert.equal(
    fallback.AUTH0_IDENTITY_LINK_CLAIMS,
    '{"version":1,"dispositions":[]}',
  );
  assert.equal(fallback.AUTH0_AUDIENCE, "urn:synthetic");
  assert.equal(fallback.NODE_EXTRA_CA_CERTS, "/private/secrets/ca.crt");
  assert.equal("MCP_RESOURCE" in fallback, false);
  assert.equal("MCP_HTTP_ALLOWED_ORIGINS" in fallback, false);
  assert.equal(fallback.COREPACK_ENABLE_NETWORK, "0");
  assert.equal(JSON.stringify(fallback).includes("caller-secret"), false);
  assert.equal(JSON.stringify(fallback).includes("/caller/home"), false);

  const explicit = buildPackagedRuntimeEnvironment(
    { PATH: "/bin" },
    {
      home: "/private/runtime/home",
      temp: "/private/runtime/tmp",
      proxyOrigin: "http://127.0.0.1:41001",
      webOrigin: "http://127.0.0.1:41002",
      databaseUrl: "postgresql://synthetic@127.0.0.1:5433/context_router_deadbeef_test",
      auth: {
        domain: "127.0.0.1:4443",
        issuer: "https://127.0.0.1:4443/",
        audience: "urn:synthetic",
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        sessionSecret: "synthetic-session-secret",
        caCertificate: "/private/secrets/ca.crt",
      },
      explicitMcpResource: true,
      explicitMcpAllowedOrigins: true,
    },
  );
  assert.equal(explicit.MCP_RESOURCE, "http://127.0.0.1:41001/mcp");
  assert.equal(explicit.MCP_HTTP_ALLOWED_ORIGINS, "http://127.0.0.1:41002");
  assert.throws(
    () =>
      buildPackagedRuntimeEnvironment(
        { PATH: "/bin" },
        {
          home: "/private/runtime/home",
          temp: "/private/runtime/tmp",
          proxyOrigin: "http://127.0.0.1:41001",
          webOrigin: "http://127.0.0.1:41002",
          databaseUrl: "postgresql://synthetic@127.0.0.1:5433/context_router_deadbeef_test",
          auth: {
            domain: "127.0.0.1:4443",
            issuer: "https://127.0.0.1:4443/",
            audience: "urn:synthetic",
            clientId: "synthetic-client",
            clientSecret: "synthetic-secret",
          },
        },
      ),
    /sessionSecret/,
  );
});

test("backend readiness parsing accepts only the structured loopback record", () => {
  assert.deepEqual(
    parseBackendReadinessLine(
      '{"type":"context-router.backend.ready","version":1,"address":"127.0.0.1","port":43123}',
    ),
    { address: "127.0.0.1", port: 43123 },
  );
  assert.equal(parseBackendReadinessLine("Application is running"), null);
  assert.throws(
    () =>
      parseBackendReadinessLine(
        '{"type":"context-router.backend.ready","version":1,"address":"0.0.0.0","port":43123}',
      ),
    /loopback/,
  );
});

test("stable proxy is loopback-only, fail-closed, and switches exact targets", async () => {
  let firstRequests = 0;
  const firstSockets = new Set();
  const first = createServer((request, response) => {
    firstRequests += 1;
    response.end(`one:${request.url}`);
  });
  first.on("connection", (socket) => {
    firstSockets.add(socket);
    socket.once("close", () => firstSockets.delete(socket));
  });
  const second = createServer((request, response) => {
    response.end(`two:${request.url}`);
  });
  const firstOrigin = await listen(first);
  const secondOrigin = await listen(second);
  const proxy = await createStableLoopbackProxy();
  try {
    assert.match(proxy.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
    const before = await fetch(`${proxy.origin}/health`, { redirect: "manual" });
    assert.equal(before.status, 503);
    proxy.setTarget(firstOrigin);
    assert.equal(await (await fetch(`${proxy.origin}/health`)).text(), "one:/health");
    const rejectedAbsoluteForm = await new Promise((resolve, reject) => {
      const request = httpRequest(
        proxy.origin,
        { path: `${secondOrigin}/must-not-forward`, method: "GET" },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      request.once("error", reject);
      request.end();
    });
    assert.equal(rejectedAbsoluteForm, 400);
    assert.equal(firstRequests, 1);
    for (const socket of firstSockets) socket.resetAndDestroy();
    await new Promise((resolve) => setTimeout(resolve, 25));
    proxy.setTarget(secondOrigin);
    assert.equal(await (await fetch(`${proxy.origin}/graphql`)).text(), "two:/graphql");
    proxy.clearTarget();
    assert.equal((await fetch(`${proxy.origin}/health`)).status, 503);
  } finally {
    await proxy.close();
    await Promise.all([close(first), close(second)]);
  }
});

test("web startup retries only a bounded EADDRINUSE collision and cleans the failed child", async () => {
  const ports = [41001, 41002];
  const stopped = [];
  const started = await startWebWithAddressRetry({
    allocatePort: async () => ports.shift(),
    start: async ({ port, attempt }) => ({
      managed: {
        id: attempt,
        outputTail: () => (attempt === 1 ? "listen EADDRINUSE" : "ready"),
      },
      origin: `http://127.0.0.1:${port}`,
    }),
    waitReady: async ({ managed }) => {
      if (managed.id === 1) throw new Error("web exited before readiness");
    },
    stop: async (managed) => stopped.push(managed.id),
  });
  assert.equal(started.port, 41002);
  assert.equal(started.attempts, 2);
  assert.deepEqual(stopped, [1]);

  await assert.rejects(
    startWebWithAddressRetry({
      allocatePort: async () => 42001,
      start: async () => ({
        managed: { id: 3, outputTail: () => "unexpected syntax failure" },
      }),
      waitReady: async () => {
        throw new Error("unexpected syntax failure");
      },
      stop: async (managed) => stopped.push(managed.id),
    }),
    /unexpected syntax failure/,
  );
  assert.deepEqual(stopped, [1, 3]);
});

test("web retries persist each distinct PID before readiness and terminalize collisions", async () => {
  await temporaryDirectory("packaging-web-retry-journal-test-", async (root) => {
    const journal = await createResourceLifecycleJournal(root);
    const lifecycle = createWebAttemptLifecycleHooks({ generation: 7, journal });
    const stopped = [];
    const started = await startWebWithAddressRetry({
      maxAttempts: 2,
      allocatePort: async () => 43000 + journal.state.resources.length,
      ...lifecycle,
      start: async ({ attempt, port, registerManaged }) => {
        const managed = {
          child: { pid: 9100 + attempt },
          outputTail: () => (attempt === 1 ? "listen EADDRINUSE" : "ready"),
        };
        registerManaged(managed);
        return { managed, origin: `http://127.0.0.1:${port}` };
      },
      waitReady: async ({ managed }) => {
        const persisted = JSON.parse(await readFile(journal.filePath, "utf8"));
        const current = persisted.resources.at(-1);
        assert.equal(current.status, "acquired");
        assert.equal(current.identity.pid, managed.child.pid);
        if (current.identity.attempt === 1) {
          throw new Error("listen EADDRINUSE before readiness");
        }
        const first = persisted.resources[0];
        assert.equal(first.cleanup.status, "exited");
      },
      stop: async (managed) => stopped.push(managed.child.pid),
    });
    assert.equal(started.attemptContext.id, "web-generation-7-attempt-2");
    assert.deepEqual(stopped, [9101]);
    assert.deepEqual(
      journal.state.resources.map(({ id }) => id),
      ["web-generation-7-attempt-1", "web-generation-7-attempt-2"],
    );
    assert.equal(journal.state.resources[0].cleanup.status, "exited");
    assert.equal(journal.state.resources[1].status, "acquired");
    await journal.cleanupFinished(started.attemptContext.id, { status: "exited" });
  });
});

test("web retry never hides lifecycle-hook failures that mention EADDRINUSE", async () => {
  let allocations = 0;
  let readinessCalls = 0;
  let stopCalls = 0;
  let stoppedRecord;
  await assert.rejects(
    startWebWithAddressRetry({
      maxAttempts: 3,
      allocatePort: async () => {
        allocations += 1;
        return 44000 + allocations;
      },
      beginAttempt: async () => ({ id: "attempt-1" }),
      start: async ({ registerManaged }) => {
        const managed = { child: { pid: 9201 }, outputTail: () => "" };
        registerManaged(managed);
        return { managed };
      },
      recordStarted: async () => {
        throw new Error("journal EADDRINUSE sentinel");
      },
      waitReady: async () => {
        readinessCalls += 1;
      },
      stop: async () => {
        stopCalls += 1;
      },
      recordStopped: async (record) => {
        stoppedRecord = record;
      },
    }),
    /journal EADDRINUSE sentinel/,
  );
  assert.equal(allocations, 1);
  assert.equal(readinessCalls, 0);
  assert.equal(stopCalls, 1);
  assert.equal(stoppedRecord.started.managed.child.pid, 9201);
});

test("web retry retains an immediately registered handle when start later throws", async () => {
  const stopped = [];
  let recorded;
  await assert.rejects(
    startWebWithAddressRetry({
      maxAttempts: 2,
      allocatePort: async () => 45001,
      beginAttempt: async () => ({ id: "attempt-1" }),
      start: async ({ registerManaged }) => {
        const managed = { child: { pid: 9301 }, outputTail: () => "EADDRINUSE" };
        registerManaged(managed);
        throw new Error("post-spawn EADDRINUSE failure");
      },
      waitReady: async () => assert.fail("readiness must not run"),
      stop: async (managed) => stopped.push(managed.child.pid),
      recordStopped: async (value) => {
        recorded = value;
      },
    }),
    /post-spawn EADDRINUSE failure/,
  );
  assert.deepEqual(stopped, [9301]);
  assert.equal(recorded.started.managed.child.pid, 9301);
});

test("managed child readiness rejection is observed before delayed journal work", async () => {
  await temporaryDirectory("packaging-fast-exit-test-", async (root) => {
    const entrypoint = path.join(root, "exit.mjs");
    const diagnostics = path.join(root, "diagnostics");
    await mkdir(diagnostics, { mode: 0o700 });
    await writeFile(entrypoint, "process.exitCode = 17;\n", { mode: 0o600 });
    const managed = await startManagedChild({
      name: "fast-exit",
      entrypoint,
      cwd: root,
      environment: { PATH: process.env.PATH },
      diagnostics,
      canaries: [],
      readinessParser: () => null,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(managed.readyPromise, /exited before readiness/);
    await managed.closePromise;
    await assert.rejects(
      stopManagedChild(managed, "SIGTERM"),
      /exited before shutdown was requested/,
    );
  });
});

test("managed shutdown removes descendants after the process-group leader exits", async () => {
  if (process.platform === "win32") return;
  await temporaryDirectory("packaging-leader-exit-test-", async (root) => {
    const grandchild = path.join(root, "grandchild.mjs");
    const parent = path.join(root, "parent.mjs");
    const diagnostics = path.join(root, "diagnostics");
    await mkdir(diagnostics, { mode: 0o700 });
    await writeFile(grandchild, "setInterval(() => {}, 1000);\n", { mode: 0o600 });
    await writeFile(
      parent,
      [
        'import { spawn } from "node:child_process";',
        'const child = spawn(process.execPath, [new URL("./grandchild.mjs", import.meta.url).pathname], { stdio: "ignore" });',
        "child.unref();",
        'process.stdout.write(JSON.stringify({ type: "ready", grandchildPid: child.pid }) + "\\n");',
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    const managed = await startManagedChild({
      name: "leader-exit",
      entrypoint: parent,
      cwd: root,
      environment: { PATH: process.env.PATH },
      diagnostics,
      canaries: [],
      readinessParser(line) {
        const record = JSON.parse(line);
        return record.type === "ready" ? record : null;
      },
    });
    const ready = await managed.readyPromise;
    await managed.closePromise;
    assert.doesNotThrow(() => process.kill(ready.grandchildPid, 0));
    try {
      await stopManagedChild(managed, "SIGTERM", { requireRunning: false });
      assert.equal(await isProcessLive(ready.grandchildPid), false);
    } finally {
      try {
        process.kill(ready.grandchildPid, "SIGKILL");
      } catch {}
    }
  });
});

test("managed shutdown accepts only the exit code for the requested POSIX signal", async () => {
  if (process.platform === "win32") return;
  await temporaryDirectory("packaging-signal-exit-test-", async (root) => {
    const entrypoint = path.join(root, "signal-exit.mjs");
    const diagnostics = path.join(root, "diagnostics");
    await mkdir(diagnostics, { mode: 0o700 });
    await writeFile(
      entrypoint,
      [
        'process.on("SIGINT", () => process.exit(130));',
        'process.on("SIGTERM", () => process.exit(130));',
        'process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");',
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    async function start(name) {
      const managed = await startManagedChild({
        name,
        entrypoint,
        cwd: root,
        environment: { PATH: process.env.PATH },
        diagnostics,
        canaries: [],
        readinessParser(line) {
          const record = JSON.parse(line);
          return record.type === "ready" ? record : null;
        },
      });
      await managed.readyPromise;
      return managed;
    }

    const sigint = await start("sigint-exit");
    await assert.doesNotReject(stopManagedChild(sigint, "SIGINT"));

    const mismatched = await start("mismatched-signal-exit");
    await assert.rejects(
      stopManagedChild(mismatched, "SIGTERM"),
      /exited unexpectedly \(130\)/,
    );
  });
});

test("managed shutdown rejects a race that prevents signal delivery", async () => {
  const status = {
    exited: false,
    exitCode: 0,
    signal: null,
    error: null,
    abortSignalError: null,
  };
  const managed = {
    name: "signal-race",
    child: {
      pid: undefined,
      kill() {
        return false;
      },
    },
    status,
    closePromise: Promise.resolve().then(() => {
      status.exited = true;
      return status;
    }),
    async finishLog() {},
  };
  await assert.rejects(
    stopManagedChild(managed, "SIGTERM"),
    /exited before SIGTERM could be delivered/,
  );
});

test("owned process and TCP waits fail boundedly when dependencies hang", async () => {
  await assert.rejects(
    waitWithTimeout(
      new Promise(() => {}),
      5,
      "injected close wait timed out",
    ),
    /injected close wait timed out/,
  );

  let destroyed = false;
  await assert.rejects(
    requireTcpConnection({
      host: "127.0.0.1",
      port: 1,
      timeoutMs: 5,
      connect() {
        const socket = new EventEmitter();
        socket.destroy = () => {
          destroyed = true;
        };
        return socket;
      },
    }),
    /TCP connection probe timed out/,
  );
  assert.equal(destroyed, true);
});

test("network-interface evidence preserves family/scope and treats empty or timeout as inconclusive", () => {
  assert.deepEqual(
    enumerateNonLoopbackProbeTargets({
      lo0: [
        { address: "127.0.0.1", family: "IPv4", internal: true },
        { address: "::1", family: "IPv6", internal: true },
      ],
      en0: [
        { address: "192.0.2.20", family: "IPv4", internal: false },
        {
          address: "fe80::1%en0",
          family: "IPv6",
          internal: false,
          scopeid: 7,
        },
      ],
    }),
    [
      {
        interface: "en0",
        address: "192.0.2.20",
        family: 4,
        scopeid: null,
      },
      {
        interface: "en0",
        address: "fe80::1%en0",
        family: 6,
        scopeid: 7,
      },
    ],
  );
  assert.throws(
    () => enumerateNonLoopbackProbeTargets({ lo0: [] }),
    /no non-loopback addresses/,
  );
  assert.equal(classifyNegativeProbe({ errorCode: "ECONNREFUSED" }), "unreachable");
  assert.equal(classifyNegativeProbe({ errorCode: "EHOSTUNREACH" }), "unreachable");
  assert.equal(classifyNegativeProbe({ errorCode: "ENETDOWN" }), "unreachable");
  assert.equal(classifyNegativeProbe({ timedOut: true }), "inconclusive");
  assert.equal(classifyNegativeProbe({ connected: true }), "reachable");
  assert.equal(classifyNegativeProbe({ errorCode: "EINVAL" }), "inconclusive");
  assert.equal(
    formatNetworkProbeHost({
      interface: "awdl0",
      address: "fe80::1",
      family: 6,
      scopeid: 12,
    }),
    "fe80::1%awdl0",
  );
  assert.equal(
    formatNetworkProbeHost({
      interface: "en0",
      address: "fe80::1%en0",
      family: 6,
      scopeid: 7,
    }),
    "fe80::1%en0",
  );
});

test("Darwin listener evidence parses native rows and invokes exact shell-free lsof", async () => {
  const signal = new AbortController().signal;
  let invocation;
  const listener = {
    name: "backend-generation-1",
    pid: 12540,
    address: "127.0.0.1",
    port: 4322,
  };
  const fixture =
    "p12540\0\nf14\0PTCP\0n127.0.0.1:4322\0TST=LISTEN\0TQR=0\0" +
    "f15\0PTCP\0n127.0.0.1:4322\0TST=LISTEN\0";
  assert.deepEqual(parseDarwinLsofListenerRows(fixture), [
    {
      pid: 12540,
      fd: "14",
      protocol: "TCP",
      endpoint: "127.0.0.1:4322",
      state: "LISTEN",
    },
    {
      pid: 12540,
      fd: "15",
      protocol: "TCP",
      endpoint: "127.0.0.1:4322",
      state: "LISTEN",
    },
  ]);
  const evidence = await collectDarwinListenerEvidence(listener, {
    signal,
    async execute(executable, args, options) {
      invocation = { executable, args, options };
      return { stdout: fixture, stderr: "" };
    },
  });
  assert.equal(invocation.executable, "/usr/sbin/lsof");
  assert.deepEqual(invocation.args, [
    "-nP",
    "-a",
    "-p",
    "12540",
    "-iTCP:4322",
    "-sTCP:LISTEN",
    "-F0pfnPT",
  ]);
  assert.deepEqual(invocation.options.env, {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C",
    LC_ALL: "C",
  });
  assert.equal(invocation.options.encoding, "utf8");
  assert.equal(invocation.options.timeout, 5_000);
  assert.equal(invocation.options.maxBuffer, 64 * 1024);
  assert.equal(invocation.options.signal, signal);
  assert.deepEqual(
    evidence.map(({ fd, address, port, classification }) => ({
      fd,
      address,
      port,
      classification,
    })),
    [
      { fd: "14", address: "127.0.0.1", port: 4322, classification: "loopback-only" },
      { fd: "15", address: "127.0.0.1", port: 4322, classification: "loopback-only" },
    ],
  );
});

test("Darwin listener evidence rejects wildcard, mixed, malformed, and tool failures", async () => {
  const listener = {
    name: "stable-proxy",
    pid: 15001,
    address: "127.0.0.1",
    port: 7000,
  };
  const executeWith = (stdout, stderr = "") => async () => ({ stdout, stderr });
  for (const output of [
    "p15001\0f8\0PTCP\0n*:7000\0TST=LISTEN\0",
    "p15001\0f8\0PTCP\0n127.0.0.1:7000\0TST=LISTEN\0f9\0PTCP\0n0.0.0.0:7000\0TST=LISTEN\0",
    "p15002\0f8\0PTCP\0n127.0.0.1:7000\0TST=LISTEN\0",
    "p15001\0f8\0PUDP\0n127.0.0.1:7000\0TST=LISTEN\0",
    "p15001\0f8\0PTCP\0n127.0.0.1:7000\0",
    "not-nul-delimited",
  ]) {
    await assert.rejects(
      collectDarwinListenerEvidence(listener, { execute: executeWith(output) }),
      /listener|lsof|endpoint|ownership/i,
    );
  }
  await assert.rejects(
    collectDarwinListenerEvidence(listener, {
      execute: executeWith(
        "p15001\0f8\0PTCP\0n127.0.0.1:7000\0TST=LISTEN\0",
        "unexpected diagnostic",
      ),
    }),
    /wrote stderr/,
  );
  await assert.rejects(
    collectDarwinListenerEvidence(listener, {
      async execute() {
        throw new Error("ENOENT");
      },
    }),
    /native listener inspection failed/,
  );
  await assert.rejects(
    collectDarwinListenerEvidence(
      { ...listener, address: "127.0.0.2" },
      {
        execute: executeWith(
          "p15001\0f8\0PTCP\0n127.0.0.2:7000\0TST=LISTEN\0",
        ),
      },
    ),
    /exactly 127\.0\.0\.1/,
  );
  await assert.rejects(
    collectDarwinListenerEvidence(
      { ...listener, address: "::1" },
      { execute: executeWith("p15001\0f8\0PTCP\0n[::1]:7000\0TST=LISTEN\0") },
    ),
    /exactly 127\.0\.0\.1/,
  );
});

test("Darwin listener dispatch never uses route-dependent interface probes", async () => {
  const listeners = [
    { name: "web", pid: 16001, address: "127.0.0.1", port: 7100 },
  ];
  let collected = 0;
  const result = await collectListenerIsolationEvidence(listeners, {
    platform: "darwin",
    async collectDarwin(listener) {
      collected += 1;
      return [{
        method: "darwin-lsof-listener-table",
        listener: listener.name,
        address: listener.address,
        port: listener.port,
      }];
    },
    enumerateTargets() {
      assert.fail("Darwin dispatch must not enumerate route-dependent interfaces");
    },
    probe() {
      assert.fail("Darwin dispatch must not connect to route-dependent interfaces");
    },
  });
  assert.equal(collected, 1);
  assert.equal(result.method, "darwin-lsof-listener-table");
  assert.equal(result.failures.length, 0);
});

test("listener isolation fails closed on analysis-only platforms", async () => {
  for (const platform of ["freebsd", "win32"]) {
    await assert.rejects(
      collectListenerIsolationEvidence(
        [{ name: "web", pid: 17001, address: "127.0.0.1", port: 7200 }],
        {
          platform,
          enumerateTargets() {
            assert.fail("unsupported platforms must not use Linux probes");
          },
          probe() {
            assert.fail("unsupported platforms must not use Linux probes");
          },
        },
      ),
      new RegExp(`unsupported listener isolation platform: ${platform}`),
    );
  }
});

test("listener isolation requires the literal IPv4 loopback contract", async () => {
  for (const platform of ["darwin", "linux"]) {
    for (const address of ["127.0.0.2", "::1"]) {
      await assert.rejects(
        collectListenerIsolationEvidence(
          [{ name: "web", pid: 18001, address, port: 7300 }],
          {
            platform,
            collectDarwin() {
              assert.fail("invalid readiness must fail before native inspection");
            },
            enumerateTargets() {
              assert.fail("invalid readiness must fail before Linux probes");
            },
          },
        ),
        /exactly 127\.0\.0\.1/,
      );
    }
  }
});

test("Linux listener isolation stops probing immediately when cancelled", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel listener isolation");
  let probes = 0;
  await assert.rejects(
    collectListenerIsolationEvidence(
      [{ name: "web", pid: 19001, address: "127.0.0.1", port: 7400 }],
      {
        platform: "linux",
        signal: controller.signal,
        enumerateTargets() {
          return [
            { interface: "eth0", address: "192.0.2.10", family: 4 },
            { interface: "eth1", address: "192.0.2.11", family: 4 },
          ];
        },
        async probe(_target, _port, options) {
          probes += 1;
          assert.equal(options.signal, controller.signal);
          controller.abort(reason);
          return { errorCode: "ECONNREFUSED" };
        },
      },
    ),
    reason,
  );
  assert.equal(probes, 1);
});

test("redaction and lifecycle validation reject raw, encoded, split, or incomplete evidence", () => {
  const canary = "synthetic secret/value";
  const encoded = encodeURIComponent(canary);
  const base64 = Buffer.from(canary).toString("base64");
  assert.doesNotThrow(() =>
    assertNoCanaryLeak(
      ["safe output", "<redacted-canary>", "synthetic ***"],
      [canary],
    ),
  );
  for (const leaked of [canary, encoded, base64, `prefix ${canary.slice(0, 9)}${canary.slice(9)}`]) {
    assert.throws(() => assertNoCanaryLeak([leaked], [canary]), /canary/);
  }

  assert.doesNotThrow(() =>
    assertCompletedLifecycle({
      schemaVersion: 1,
      status: "passed",
      resources: [
        {
          id: "proxy",
          type: "proxy",
          status: "acquired",
          cleanup: { status: "closed" },
        },
        {
          id: "stage",
          type: "stage",
          status: "acquired",
          cleanup: { status: "removed" },
        },
      ],
    }),
  );
  for (const invalid of [
    { schemaVersion: 1, status: "running", resources: [] },
    { schemaVersion: 2, status: "passed", resources: [] },
    {
      schemaVersion: 1,
      status: "passed",
      resources: [
        {
          id: "proxy",
          type: "proxy",
          status: "acquired",
          cleanup: { status: "pending" },
        },
      ],
    },
    {
      schemaVersion: 1,
      status: "passed",
      resources: [
        {
          id: "proxy",
          type: "proxy",
          status: "acquired",
          cleanup: { status: "closed" },
          recoveryRequired: true,
        },
      ],
    },
  ]) {
    assert.throws(() => assertCompletedLifecycle(invalid), /lifecycle/);
  }
  const leaked = new Error("Bearer recursive-secret");
  leaked.cause = new Error("recursive-secret");
  const sanitized = createSanitizedPackagingError(leaked, ["recursive-secret"]);
  assert.equal(sanitized.cause, undefined);
  assert.equal(
    [sanitized.message, sanitized.stack].join("\n").includes("recursive-secret"),
    false,
  );
  assert.equal(PACKAGED_SMOKE_TERMINATION_GRACE_MS, 180_000);
});
