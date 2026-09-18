import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  assertCallerIntegrity,
  assertContractBaselineComparisonPerformed,
  assertSafePostgresEndpoint,
  assertServerVerifiedTestDatabase,
  buildIsolatedGateEnvironment,
  buildIsolatedGitEnvironment,
  buildPhaseEnvironment,
  captureCallerIntegrity,
  copyWorkspaceFiles,
  cloneCorepackCache,
  cloneDependencyTrees,
  createResourceLifecycleJournal,
  createStreamingRedactor,
  prepareOwnedTemporaryDirectory,
  redactSecrets,
  runCommand,
  runPhaseSequence,
  createSignalAbortController,
  resolveOwnedArtifactPath,
  validateGeneratedDatabaseName,
  validateApprovedPhaseCommands,
  validateMergeBase,
  validatePhaseManifest,
  gitWithoutHooks,
  hasLiveProcessGroupMembers,
  isProcessLive,
  loadAcceptedDecisionEvidence,
  parseLinuxProcessStat,
  readContractBaselineComparisonEvidence,
  resourceLifecycleDynamicValues,
  writeSanitizedJson,
} from "./gate-runner.mjs";

const fullSha = "0123456789abcdef0123456789abcdef01234567";

test("Linux process stat parsing tolerates closing parentheses in command names", () => {
  assert.deepEqual(
    parseLinuxProcessStat(
      "321 (worker ) name) Z 12 77 77 0 -1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0",
    ),
    { state: "Z", processGroupId: 77 },
  );
  assert.throws(() => parseLinuxProcessStat("not a proc stat record"), /process stat/);
});

test("Linux liveness treats zombie-only evidence as terminal and ambiguity as active", async () => {
  const stats = new Map([
    ["401", "401 (leader) Z 1 88 88 0 -1 0 0"],
    ["402", "402 (child) X 1 88 88 0 -1 0 0"],
    ["403", "403 (other) S 1 99 99 0 -1 0 0"],
  ]);
  const options = {
    platform: "linux",
    signalProcess() {},
    async listProcessIds() {
      return [...stats.keys()];
    },
    async readProcessStat(pid) {
      return stats.get(String(pid));
    },
  };
  assert.equal(await hasLiveProcessGroupMembers(88, options), false);
  assert.equal(await isProcessLive(401, options), false);

  stats.set("402", "402 (child) S 1 88 88 0 -1 0 0");
  assert.equal(await hasLiveProcessGroupMembers(88, options), true);
  assert.equal(await isProcessLive(402, options), true);

  stats.set("402", "malformed");
  assert.equal(await hasLiveProcessGroupMembers(88, options), true);
  assert.equal(await isProcessLive(402, options), true);

  const unreadable = new Error("denied");
  unreadable.code = "EACCES";
  assert.equal(
    await hasLiveProcessGroupMembers(88, {
      ...options,
      async readProcessStat(pid) {
        if (String(pid) === "402") throw unreadable;
        return stats.get(String(pid));
      },
    }),
    true,
  );
  assert.equal(
    await isProcessLive(402, {
      ...options,
      async readProcessStat() {
        throw unreadable;
      },
    }),
    true,
  );

  const vanished = new Error("gone");
  vanished.code = "ENOENT";
  assert.equal(
    await hasLiveProcessGroupMembers(88, {
      ...options,
      async readProcessStat(pid) {
        if (String(pid) === "402") throw vanished;
        return stats.get(String(pid));
      },
    }),
    false,
  );
  assert.equal(
    await isProcessLive(402, {
      ...options,
      async readProcessStat() {
        throw vanished;
      },
    }),
    false,
  );

  const absent = new Error("missing");
  absent.code = "ESRCH";
  assert.equal(
    await hasLiveProcessGroupMembers(88, {
      ...options,
      signalProcess() {
        throw absent;
      },
    }),
    false,
  );
  assert.equal(
    await isProcessLive(402, {
      ...options,
      signalProcess() {
        throw absent;
      },
    }),
    false,
  );

  let listed = false;
  assert.equal(
    await hasLiveProcessGroupMembers(88, {
      ...options,
      platform: "darwin",
      async listProcessIds() {
        listed = true;
        return [];
      },
    }),
    true,
  );
  assert.equal(listed, false);

  const listFailure = new Error("proc unavailable");
  listFailure.code = "EACCES";
  assert.equal(
    await hasLiveProcessGroupMembers(88, {
      ...options,
      async listProcessIds() {
        throw listFailure;
      },
    }),
    true,
  );

  let probes = 0;
  assert.equal(
    await hasLiveProcessGroupMembers(88, {
      ...options,
      signalProcess() {
        probes += 1;
      },
      async listProcessIds() {
        return ["403"];
      },
    }),
    true,
  );
  assert.equal(probes, 2);
});

test("redactSecrets removes URL credentials, bearer values, JWTs, assignments, and canaries", () => {
  const jwt = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;
  const output = redactSecrets(
    `postgresql://alice:p%40ss@127.0.0.1/db_test Authorization: Bearer token-123 ${jwt} AUTH0_CLIENT_SECRET=hunter2 canary-raw`,
    ["canary-raw"],
  );

  for (const secret of ["alice", "p%40ss", "token-123", jwt, "hunter2", "canary-raw"]) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /postgresql:\/\/<redacted>@127\.0\.0\.1\/db_test/);
});

test("redactSecrets covers arbitrary URL userinfo, sensitive query parameters, and lowercase assignments", () => {
  const output = redactSecrets(
    "https://alice:p%40ss@example.test/path?keep=1&token=query-secret&api_key=key-secret auth0_client_secret=lower-secret",
  );
  for (const secret of ["alice", "p%40ss", "query-secret", "key-secret", "lower-secret"]) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /https:\/\/<redacted>@example\.test/);
  assert.match(output, /keep=1/);
  assert.match(output, /token=<redacted>/);
  assert.match(output, /api_key=<redacted>/);
});

test("streaming redaction does not leak secrets split across output chunks", () => {
  const writes = [];
  const stream = createStreamingRedactor((chunk) => writes.push(chunk), ["canary-split"]);
  stream.write("Authorization: Bea");
  stream.write("rer split-secret\ncanary-");
  stream.write("split\nordinary output\n");
  stream.end();
  const output = writes.join("");
  assert.equal(output.includes("split-secret"), false);
  assert.equal(output.includes("canary-split"), false);
  assert.match(output, /ordinary output/);
});

test("generated database names are narrowly scoped to random _test databases", () => {
  assert.equal(
    validateGeneratedDatabaseName("context_router_0123abcdef_test"),
    "context_router_0123abcdef_test",
  );
  for (const unsafe of [
    "context_router_test",
    "context_router_0123abcdef",
    "postgres",
    "context_router_../../_test",
    "context_router_ABCDEF_test",
  ]) {
    assert.throws(() => validateGeneratedDatabaseName(unsafe), /generated test database/);
  }
});

test("database safety accepts only loopback-resolved and loopback-connected TCP endpoints", async () => {
  const accepted = await assertSafePostgresEndpoint(
    "postgresql://postgres:secret@localhost:5433/postgres",
    {
      lookup: async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ],
      inspectPeer: async () => "::ffff:127.0.0.1",
    },
  );
  assert.equal(accepted.hostname, "localhost");

  await assert.rejects(
    assertSafePostgresEndpoint("postgresql://postgres:secret@mixed.invalid/postgres", {
      lookup: async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "203.0.113.9", family: 4 },
      ],
      inspectPeer: async () => "127.0.0.1",
    }),
    (error) => {
      assert.match(error.message, /non-loopback DNS address/);
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );

  await assert.rejects(
    assertSafePostgresEndpoint("postgres://postgres:secret@127.0.0.1/postgres", {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      inspectPeer: async () => "10.0.0.5",
    }),
    /connected PostgreSQL peer is not loopback/,
  );
});

test("database safety accepts an explicitly selected local Unix socket and forbids schema isolation", async () => {
  const accepted = await assertSafePostgresEndpoint(
    "postgresql://postgres:secret@localhost/postgres?host=%2Ftmp%2Fpg-test",
    { inspectPeer: async () => null },
  );
  assert.equal(accepted.unixSocket, "/tmp/pg-test");

  await assert.rejects(
    assertSafePostgresEndpoint(
      "postgresql://postgres:secret@127.0.0.1/postgres?schema=gate",
      {
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
        inspectPeer: async () => "127.0.0.1",
      },
    ),
    /schema parameter/,
  );
});

test("database safety accepts bracketed IPv6 loopback only when the connected peer is loopback", async () => {
  const accepted = await assertSafePostgresEndpoint(
    "postgresql://postgres:secret@[::1]:5433/postgres",
    { inspectPeer: async () => "::1" },
  );
  assert.equal(accepted.hostname, "::1");
  await assert.rejects(
    assertSafePostgresEndpoint(
      "postgresql://postgres:secret@[::1]:5433/postgres",
      { inspectPeer: async () => "2001:db8::1" },
    ),
    /connected PostgreSQL peer is not loopback/,
  );
});

test("phase environments expose database credentials only to their named consumers", () => {
  const base = { PATH: "/bin", SAFE: "yes" };
  const values = {
    databaseUrl: "postgresql://user:db-secret@127.0.0.1/test",
    administrationUrl: "postgresql://admin:admin-secret@127.0.0.1/postgres",
    baseSha: "a".repeat(40),
    baseDirectory: "/tmp/base",
    baseManifestSha256: "c".repeat(64),
    diagnosticsDirectory: "/tmp/diagnostics",
    pythonBin: "/usr/bin/python3.12",
    pythonCacheDirectory: "/tmp/workspace/.lmbg-python-cache",
    trackedSdlSha256: "b".repeat(64),
  };
  const contracts = buildPhaseEnvironment(base, "contract-baseline", {
    ...values,
    commandArgv: ["node", "scripts/local-migration/check-contract-baseline.mjs"],
  });
  assert.equal(contracts.MIGRATION_GATE_BASE_SHA, values.baseSha);
  assert.equal(contracts.DATABASE_URL, undefined);
  assert.equal(contracts.MIGRATION_TEST_ADMIN_URL, undefined);
  assert.equal(
    contracts.MIGRATION_GATE_BASELINE_MANIFEST_SHA256,
    values.baseManifestSha256,
  );
  assert.equal(contracts.MIGRATION_GATE_REQUIRE_BASE_COMPARISON, "1");
  const contractTests = buildPhaseEnvironment(base, "contract-baseline", values);
  assert.equal(contractTests.MIGRATION_GATE_BASELINE_DIR, values.baseDirectory);
  assert.equal(contractTests.MIGRATION_GATE_REQUIRE_BASE_COMPARISON, "1");

  const database = buildPhaseEnvironment(base, "backend-database", {
    ...values,
    commandArgv: ["pnpm", "--filter", "backend", "test:integration"],
  });
  assert.equal(database.DATABASE_URL, values.databaseUrl);
  assert.equal(database.NODE_ENV, "test");
  assert.equal(database.MIGRATION_TEST_ADMIN_URL, undefined);
  assert.equal(database.MIGRATION_GATE_REQUIRE_BASE_COMPARISON, undefined);

  const smoke = buildPhaseEnvironment(base, "restart-smoke", values);
  assert.equal(smoke.DATABASE_URL, undefined);
  assert.equal(smoke.MIGRATION_TEST_ADMIN_URL, values.administrationUrl);

  const web = buildPhaseEnvironment(base, "web-production-build", {
    ...values,
    commandArgv: ["pnpm", "--filter", "web", "build"],
  });
  assert.equal(web.DATABASE_URL, undefined);
  assert.equal(web.MIGRATION_TEST_ADMIN_URL, undefined);
  assert.equal(web.NODE_ENV, "production");
  const backendBuild = buildPhaseEnvironment(base, "backend-unit-build", {
    ...values,
    commandArgv: ["pnpm", "--filter", "backend", "build"],
  });
  assert.equal(backendBuild.NODE_ENV, "production");
  const backendUnit = buildPhaseEnvironment(base, "backend-unit-build", {
    ...values,
    commandArgv: ["pnpm", "--filter", "backend", "test"],
  });
  assert.equal(backendUnit.NODE_ENV, "test");
  const harbor = buildPhaseEnvironment(base, "harbor-static", values);
  assert.equal(
    harbor.PYTHONPYCACHEPREFIX,
    values.pythonCacheDirectory,
  );
});

test("aggregate gate requires observable performed merge-base comparison evidence", () => {
  const checker = [
    "node",
    "scripts/local-migration/check-contract-baseline.mjs",
  ];
  assert.equal(
    readContractBaselineComparisonEvidence(
      checker,
      "[stdout] contract-baseline: ok; capabilities=39 baseComparison=performed\n",
    ),
    "performed",
  );
  assert.equal(
    readContractBaselineComparisonEvidence(
      ["node", "scripts/check-markdown-links.mjs"],
      "[stdout] baseComparison=performed\n",
    ),
    null,
  );
  for (const output of [
    "[stdout] contract-baseline: ok; capabilities=39\n",
    "[stdout] contract-baseline: ok; capabilities=39 baseComparison=skipped\n",
    "[stdout] contract-baseline: ok; baseComparison=performed baseComparison=performed\n",
  ]) {
    assert.throws(
      () => readContractBaselineComparisonEvidence(checker, output),
      /required baseComparison=performed evidence/,
    );
  }
  assert.equal(assertContractBaselineComparisonPerformed("performed"), "performed");
  assert.throws(
    () => assertContractBaselineComparisonPerformed("pending"),
    /did not record required base comparison evidence/,
  );
});

test("gate environment isolates package-manager state and disables Corepack network access", () => {
  const environment = buildIsolatedGateEnvironment(
    {
      PATH: "/bin",
      HOME: "/host/home",
      PNPM_HOME: "/host/pnpm",
      COREPACK_HOME: "/host/corepack",
    },
    "/disposable/home",
    "/disposable/corepack",
  );
  assert.equal(environment.HOME, "/disposable/home");
  assert.equal(environment.COREPACK_HOME, "/disposable/corepack");
  assert.equal(environment.COREPACK_ENABLE_NETWORK, "0");
  assert.equal(environment.PNPM_HOME, undefined);
  assert.equal(environment.XDG_CONFIG_HOME, "/disposable/home/.config");
  assert.equal(environment.XDG_CACHE_HOME, "/disposable/home/.cache");
});

test("disposable Git commands ignore global templates and hooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-git-isolation-test-"));
  const globalHome = path.join(root, "host-home");
  const isolatedHome = path.join(root, "isolated-home");
  const template = path.join(root, "template");
  const repository = path.join(root, "repository");
  const marker = path.join(root, "hook-ran");
  await mkdir(path.join(template, "hooks"), { recursive: true });
  await mkdir(globalHome, { recursive: true });
  await mkdir(isolatedHome, { recursive: true });
  await mkdir(repository, { recursive: true });
  await writeFile(
    path.join(globalHome, ".gitconfig"),
    `[init]\n\ttemplateDir = ${template}\n`,
  );
  await writeFile(
    path.join(template, "hooks", "pre-commit"),
    `#!/bin/sh\ntouch ${marker}\n`,
    { mode: 0o755 },
  );
  const environment = buildIsolatedGitEnvironment(
    { PATH: process.env.PATH, HOME: globalHome },
    isolatedHome,
  );
  try {
    await runCommand(gitWithoutHooks(["init", "--quiet"]), {
      cwd: repository,
      env: environment,
      timeoutMs: 5_000,
    });
    await writeFile(path.join(repository, "tracked.txt"), "safe\n");
    await runCommand(gitWithoutHooks(["add", "--all"]), {
      cwd: repository,
      env: environment,
      timeoutMs: 5_000,
    });
    await runCommand(
      gitWithoutHooks([
        "-c",
        "user.name=Gate",
        "-c",
        "user.email=gate@invalid.local",
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "-m",
        "safe",
      ]),
      { cwd: repository, env: environment, timeoutMs: 5_000 },
    );
    await assert.rejects(lstat(marker));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server verification independently checks current_database", async () => {
  await assert.doesNotReject(
    assertServerVerifiedTestDatabase("context_router_0123abcdef_test", async () => ({
      current_database: "context_router_0123abcdef_test",
    })),
  );
  await assert.rejects(
    assertServerVerifiedTestDatabase("context_router_0123abcdef_test", async () => ({
      current_database: "postgres",
    })),
    /server reported unexpected database/,
  );
});

test("merge-base validation requires a full resolvable ancestor commit", async () => {
  const calls = [];
  const git = async (args) => {
    calls.push(args);
    return {
      exitCode: 0,
      stdout: args[0] === "rev-parse" ? "false\n" : "",
    };
  };
  assert.equal(await validateMergeBase(fullSha, git), fullSha);
  assert.deepEqual(calls, [
    ["rev-parse", "--is-shallow-repository"],
    ["cat-file", "-e", `${fullSha}^{commit}`],
    ["merge-base", "--is-ancestor", fullSha, "HEAD"],
  ]);

  await assert.rejects(validateMergeBase("deadbeef", git), /full 40-character/);
  await assert.rejects(validateMergeBase("0".repeat(40), git), /zero SHA/);
  await assert.rejects(
    validateMergeBase(fullSha, async () => ({ exitCode: 0, stdout: "true\n" })),
    /non-shallow Git history/,
  );
  await assert.rejects(
    validateMergeBase(fullSha, async (args) => ({
      exitCode: args[0] === "rev-parse" ? 0 : 1,
      stdout: args[0] === "rev-parse" ? "false\n" : "",
    })),
    /not available as a commit/,
  );
  let count = 0;
  await assert.rejects(
    validateMergeBase(fullSha, async (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "false\n" };
      return { exitCode: ++count === 1 ? 0 : 1, stdout: "" };
    }),
    /not an ancestor/,
  );
});

test("phase manifest requires owned ordered lifecycle metadata and a smoke for every supported mode", () => {
  const valid = {
    schemaVersion: 1,
    supportedModes: [
      {
        id: "hosted-baseline",
        status: "active",
        successorModes: [],
        requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
      },
    ],
    phases: [
      {
        id: "contracts",
        order: 1,
        ownerStep: "01",
        status: "active",
        timeoutMs: 1000,
        modes: ["hosted-baseline"],
        evidenceClasses: ["contract", "build", "state", "integrity"],
        predecessors: [],
        replacementEvidence: [],
        retirementCondition: "Replace only after a reviewed successor contract exists.",
        kind: "commands",
        commands: [{ argv: ["node", "check.mjs"] }],
      },
      {
        id: "restart-smoke",
        order: 2,
        ownerStep: "01",
        status: "active",
        timeoutMs: 1000,
        modes: ["hosted-baseline"],
        evidenceClasses: ["restart"],
        predecessors: ["contracts"],
        replacementEvidence: [],
        retirementCondition: "Retire only with a passing replacement-mode smoke.",
        kind: "restart-smoke",
        commands: [{ argv: ["node", "restart-smoke.mjs"] }],
      },
    ],
  };
  assert.deepEqual(validatePhaseManifest(valid), []);

  const broken = structuredClone(valid);
  broken.phases[0].ownerStep = "";
  broken.phases[1].order = 3;
  broken.phases[1].commands[0].argv = ["pnpm", "eval:run", "--provider", "vertex"];
  assert.ok(validatePhaseManifest(broken).some((item) => item.includes("owner")));
  assert.ok(validatePhaseManifest(broken).some((item) => item.includes("contiguous")));
  assert.ok(validatePhaseManifest(broken).some((item) => item.includes("live-provider")));

  const noSmoke = structuredClone(valid);
  noSmoke.phases.pop();
  assert.ok(validatePhaseManifest(noSmoke).some((item) => item.includes("restart smoke")));

  const retiredSmoke = structuredClone(valid);
  retiredSmoke.phases[1].status = "retired";
  retiredSmoke.phases.push({
    ...structuredClone(retiredSmoke.phases[1]),
    id: "successor-smoke",
    order: 3,
    ownerStep: "11",
    status: "active",
    predecessors: ["contracts"],
  });
  retiredSmoke.phases[1].replacementEvidence = [
    {
      kind: "phase",
      phaseId: "successor-smoke",
      coveredModes: ["hosted-baseline"],
      evidenceClasses: ["restart"],
    },
  ];
  assert.deepEqual(validatePhaseManifest(retiredSmoke), []);
  retiredSmoke.phases.pop();
  assert.ok(
    validatePhaseManifest(retiredSmoke).some((item) => item.includes("replacement evidence")),
  );

  const retiredHostedMode = {
    schemaVersion: 1,
    supportedModes: [
      {
        id: "hosted-baseline",
        status: "retired",
        successorModes: ["local"],
        requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
      },
      {
        id: "local",
        status: "active",
        successorModes: [],
        requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
      },
    ],
    phases: [
      {
        id: "local-contracts",
        order: 1,
        ownerStep: "11",
        status: "active",
        timeoutMs: 1000,
        modes: ["local"],
        evidenceClasses: ["contract", "build", "state", "integrity"],
        predecessors: [],
        replacementEvidence: [],
        retirementCondition: "Retire only after another supported mode proves equivalent contracts.",
        kind: "commands",
        commands: [{ argv: ["node", "local-contracts.mjs"] }],
      },
      {
        id: "local-restart",
        order: 2,
        ownerStep: "11",
        status: "active",
        timeoutMs: 1000,
        modes: ["local"],
        evidenceClasses: ["restart"],
        predecessors: ["local-contracts"],
        replacementEvidence: [],
        retirementCondition: "Retire only after another supported mode passes clean restart.",
        kind: "restart-smoke",
        commands: [{ argv: ["node", "local-restart.mjs"] }],
      },
      {
        id: "hosted-contracts",
        order: 3,
        ownerStep: "01",
        status: "retired",
        timeoutMs: 1000,
        modes: ["hosted-baseline"],
        evidenceClasses: ["contract", "build", "state", "integrity"],
        predecessors: [],
        replacementEvidence: [
          {
            kind: "phase",
            phaseId: "local-contracts",
            coveredModes: ["hosted-baseline"],
            evidenceClasses: ["contract", "build", "state", "integrity"],
          },
        ],
        retirementCondition: "Retired after local mode proved equivalent contracts and state.",
        kind: "commands",
        commands: [{ argv: ["node", "hosted-contracts.mjs"] }],
      },
      {
        id: "hosted-restart",
        order: 4,
        ownerStep: "01",
        status: "retired",
        timeoutMs: 1000,
        modes: ["hosted-baseline"],
        evidenceClasses: ["restart"],
        predecessors: ["hosted-contracts"],
        replacementEvidence: [
          {
            kind: "phase",
            phaseId: "local-restart",
            coveredModes: ["hosted-baseline"],
            evidenceClasses: ["restart"],
          },
        ],
        retirementCondition: "Retired after local mode passed the clean restart smoke.",
        kind: "restart-smoke",
        commands: [{ argv: ["node", "hosted-restart.mjs"] }],
      },
    ],
  };
  assert.deepEqual(validatePhaseManifest(retiredHostedMode), []);
  retiredHostedMode.supportedModes[0].successorModes = [];
  assert.ok(
    validatePhaseManifest(retiredHostedMode).some((item) =>
      item.includes("exactly one active successor mode"),
    ),
  );
  retiredHostedMode.supportedModes[0].successorModes = ["local", "local-headless"];
  retiredHostedMode.supportedModes.push({
    id: "local-headless",
    status: "active",
    successorModes: [],
    requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
  });
  assert.ok(
    validatePhaseManifest(retiredHostedMode).some((item) =>
      item.includes("exactly one active successor mode"),
    ),
  );

  const invalidLifecycle = structuredClone(valid);
  invalidLifecycle.phases[0].ownerStep = "99";
  invalidLifecycle.phases[0].modes = ["unknown-mode"];
  invalidLifecycle.phases[0].status = "retired";
  invalidLifecycle.phases[0].replacementEvidence = [];
  invalidLifecycle.phases[0].timeoutMs = 0;
  const lifecycleErrors = validatePhaseManifest(invalidLifecycle);
  assert.ok(lifecycleErrors.some((item) => item.includes("roadmap owner")));
  assert.ok(lifecycleErrors.some((item) => item.includes("retired") && item.includes("replacement")));
  assert.ok(lifecycleErrors.some((item) => item.includes("timeout")));

  const activeUnknown = structuredClone(valid);
  activeUnknown.phases[0].modes = ["unknown-mode"];
  assert.ok(
    validatePhaseManifest(activeUnknown).some((item) => item.includes("unknown mode")),
  );

  const inadequateEvidence = structuredClone(valid);
  inadequateEvidence.phases[0].evidenceClasses = ["contract"];
  assert.ok(
    validatePhaseManifest(inadequateEvidence).some(
      (item) => item.includes("hosted-baseline") && item.includes("build"),
    ),
  );
});

test("decision replacement evidence resolves only exact accepted repository records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-decision-evidence-"));
  const decisions = "docs/decisions.md";
  const manifestFor = (evidencePath, decisionId) => ({
    phases: [
      {
        replacementEvidence: [
          { kind: "decision", path: evidencePath, decisionId },
        ],
      },
    ],
  });
  try {
    await mkdir(path.join(root, "docs"));
    await writeFile(
      path.join(root, decisions),
      [
        "# Decisions",
        "",
        "### LM-101: Accepted replacement",
        "",
        "- Status: Accepted",
        "- Decision: Use the reviewed replacement.",
        "",
        "### LM-102: Unreviewed replacement",
        "",
        "- Status: Provisional",
        "- Decision: More evidence is required.",
        "",
      ].join("\n"),
    );
    const accepted = await loadAcceptedDecisionEvidence(
      root,
      manifestFor(decisions, "LM-101"),
    );
    assert.equal(accepted(decisions, "LM-101"), true);

    const provisional = await loadAcceptedDecisionEvidence(
      root,
      manifestFor(decisions, "LM-102"),
    );
    assert.equal(provisional(decisions, "LM-102"), false);
    const stale = await loadAcceptedDecisionEvidence(
      root,
      manifestFor(decisions, "LM-999"),
    );
    assert.equal(stale(decisions, "LM-999"), false);

    await assert.rejects(
      loadAcceptedDecisionEvidence(
        root,
        manifestFor("docs/missing.md", "LM-101"),
      ),
      /existing regular repository file/,
    );
    await assert.rejects(
      loadAcceptedDecisionEvidence(
        root,
        manifestFor("../outside.md", "LM-101"),
      ),
      /unsafe workspace path/,
    );
    await symlink("decisions.md", path.join(root, "docs", "linked.md"));
    await assert.rejects(
      loadAcceptedDecisionEvidence(
        root,
        manifestFor("docs/linked.md", "LM-101"),
      ),
      /existing regular repository file/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved command policy rejects active phases outside the sole version-one mode", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("./gate-phases.json", import.meta.url),
      "utf8",
    ),
  );
  const injected = structuredClone(manifest);
  injected.supportedModes.push({
    id: "injected-mode",
    status: "active",
    successorModes: [],
    requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
  });
  injected.phases.push({
    ...structuredClone(injected.phases.at(-1)),
    id: "injected-command",
    order: injected.phases.length + 1,
    ownerStep: "11",
    modes: ["injected-mode"],
    commands: [{ argv: ["curl", "https://attacker.invalid/"] }],
    predecessors: [injected.phases.at(-1).id],
  });
  const errors = validateApprovedPhaseCommands(injected);
  assert.ok(errors.some((error) => error.includes("exactly hosted-baseline")));
  assert.ok(errors.some((error) => error.includes("outside the approved")));
});

test("signal abort controller converts SIGINT and SIGTERM into one observable abort", () => {
  const listeners = new Map();
  const processLike = {
    on(event, listener) {
      listeners.set(event, listener);
    },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  };
  const lifecycle = createSignalAbortController(processLike);
  listeners.get("SIGINT")();
  assert.equal(lifecycle.signal.aborted, true);
  assert.match(lifecycle.signal.reason.message, /SIGINT/);
  listeners.get("SIGTERM")();
  assert.match(lifecycle.signal.reason.message, /SIGINT/);
  lifecycle.dispose();
  assert.equal(listeners.size, 0);
});

test("phase runner is ordered, fail-fast, sanitized, and always invokes cleanup", async () => {
  const calls = [];
  let cleanups = 0;
  await assert.rejects(
    runPhaseSequence(
      [
        { id: "one", commands: [{ argv: ["one"] }] },
        { id: "two", commands: [{ argv: ["two"] }] },
        { id: "three", commands: [{ argv: ["three"] }] },
      ],
      {
        execute: async ({ argv }) => {
          calls.push(argv[0]);
          if (argv[0] === "two") {
            const error = new Error("Bearer super-secret");
            error.exitCode = 7;
            throw error;
          }
        },
        onCleanup: async () => {
          cleanups += 1;
        },
      },
    ),
    (error) => {
      assert.equal(error.message.includes("super-secret"), false);
      assert.match(error.message, /<redacted>/);
      return true;
    },
  );
  assert.deepEqual(calls, ["one", "two"]);
  assert.equal(cleanups, 1);
});

test("phase runner reports failed/skipped states and preserves cleanup failure", async () => {
  let summary;
  await assert.rejects(
    runPhaseSequence(
      [
        { id: "one", commands: [{ argv: ["one"] }] },
        { id: "two", commands: [{ argv: ["two"] }] },
      ],
      {
        execute: async () => {
          throw new Error("primary phase failure");
        },
        onSummary: async (value) => {
          summary = value;
        },
        onCleanup: async () => {
          throw new Error("cleanup failure");
        },
      },
    ),
    (error) => {
      assert.match(error.message, /primary phase failure/);
      assert.match(error.message, /cleanup failure/);
      return true;
    },
  );
  assert.deepEqual(summary.map(({ id, status }) => ({ id, status })), [
    { id: "one", status: "failed" },
    { id: "two", status: "skipped" },
  ]);
});

test("phase summary failure cannot skip cleanup", async () => {
  let cleanupRan = false;
  await assert.rejects(
    runPhaseSequence(
      [{ id: "one", commands: [{ argv: ["one"] }] }],
      {
        execute: async () => {},
        onSummary: async () => {
          throw new Error("summary write failed");
        },
        onCleanup: async () => {
          cleanupRan = true;
        },
      },
    ),
    /summary write failed/,
  );
  assert.equal(cleanupRan, true);
});

test("real command runner enforces a bounded timeout and writes only sanitized output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-command-test-"));
  const logPath = path.join(root, "command.log");
  try {
    await assert.rejects(
      runCommand(
        [
          process.execPath,
          "-e",
          "process.stdout.write('Authorization: Bea'); setTimeout(() => { process.stdout.write('rer command-secret\\n'); }, 5); setInterval(() => {}, 1000)",
        ],
        { cwd: root, timeoutMs: 250, logPath },
      ),
      /timed out/,
    );
    const log = await readFile(logPath, "utf8");
    assert.equal(log.includes("command-secret"), false);
    assert.match(log, /<redacted>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("command runner rejects invalid cleanup deadlines before spawning", async () => {
  for (const [option, value, message] of [
    ["terminationGraceMs", Number.NaN, /termination grace must be a positive integer/],
    ["terminationGraceMs", Number.POSITIVE_INFINITY, /termination grace must be a positive integer/],
    ["closeDeadlineMs", 0, /close deadline must be a positive integer/],
    ["closeDeadlineMs", Number.POSITIVE_INFINITY, /close deadline must be a positive integer/],
  ]) {
    let spawned = false;
    await assert.rejects(
      runCommand(["never-spawn"], {
        cwd: "/tmp",
        [option]: value,
        spawnProcess: () => {
          spawned = true;
          throw new Error("unexpected spawn");
        },
      }),
      message,
    );
    assert.equal(spawned, false);
  }
});

test("real command runner aborts a process group and never waits forever for close", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-command-abort-test-"));
  const controller = new AbortController();
  try {
    const startedAt = Date.now();
    const command = runCommand(
      [
        process.execPath,
        "-e",
        "process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); setInterval(() => {}, 1000)",
      ],
      {
        cwd: root,
        timeoutMs: 60_000,
        terminationGraceMs: 100,
        closeDeadlineMs: 500,
        signal: controller.signal,
      },
    );
    setTimeout(() => controller.abort(new Error("received SIGTERM")), 50);
    await assert.rejects(command, /received SIGTERM/);
    assert.ok(
      Date.now() - startedAt < 400,
      "terminationGraceMs must bound SIGTERM, SIGKILL, and close observation together",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("command runner never releases cleanup before child close is proven", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.kill = () => true;
  const controller = new AbortController();
  let settled = false;
  const running = runCommand(["synthetic-hung-child"], {
    cwd: "/tmp",
    timeoutMs: 60_000,
    terminationGraceMs: 20,
    closeDeadlineMs: 5,
    signal: controller.signal,
    spawnProcess: () => child,
  });
  running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  controller.abort(new Error("injected non-cooperative child cancellation"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(settled, false);
  child.emit("close", null, "SIGKILL");
  await assert.rejects(
    running,
    /injected non-cooperative child cancellation.*did not settle/s,
  );
});

test("command runner bounds post-leader process-group settlement", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX process-group regression");
    return;
  }
  const child = new EventEmitter();
  child.pid = 424_242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.kill = () => true;
  const signals = [];
  const startedAt = Date.now();
  await assert.rejects(
    runCommand(["synthetic-leader-exit"], {
      cwd: "/tmp",
      timeoutMs: 60_000,
      closeDeadlineMs: 5,
      spawnProcess: () => {
        setImmediate(() => child.emit("close", 0, null));
        return child;
      },
      inspectProcessGroup: async () => true,
      signalProcess: (target, signalName) => {
        signals.push([target, signalName]);
      },
    }),
    (error) => {
      assert.match(error.message, /owned process group 424242 did not settle/);
      assert.match(error.message, /leader exited while its owned process group remained/);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 250, "post-leader cleanup must be bounded");
  assert.deepEqual(signals, [[-424_242, "SIGKILL"]]);
});

test("explicit nested signal forwarding leaves no detached grandchild alive", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX process-group regression");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-grandchild-test-"));
  const scriptPath = path.join(root, "nested-runner.mjs");
  const pidPath = path.join(root, "grandchild.pid");
  const gateRunnerUrl = pathToFileURL(
    path.join(import.meta.dirname, "gate-runner.mjs"),
  ).href;
  const grandchildSource = [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  await writeFile(
    scriptPath,
    [
      `import { createSignalAbortController, runCommand } from ${JSON.stringify(gateRunnerUrl)};`,
      "const cancellation = createSignalAbortController();",
      "try {",
      `  await runCommand([process.execPath, "-e", ${JSON.stringify(grandchildSource)}], { cwd: ${JSON.stringify(root)}, signal: cancellation.signal, timeoutMs: 60000, terminationGraceMs: 50, closeDeadlineMs: 500 });`,
      "} catch {} finally { cancellation.dispose(); }",
    ].join("\n"),
  );
  const controller = new AbortController();
  try {
    const command = runCommand([process.execPath, scriptPath], {
      cwd: root,
      signal: controller.signal,
      timeoutMs: 60_000,
      terminationGraceMs: 1_000,
      closeDeadlineMs: 1_000,
    });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        await readFile(pidPath, "utf8");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const pid = Number(await readFile(pidPath, "utf8"));
    controller.abort(new Error("received SIGTERM"));
    await assert.rejects(command, /received SIGTERM/);
    let alive = true;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      alive = await isProcessLive(pid);
      if (!alive) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(alive, false, `detached grandchild ${pid} survived cancellation`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a zero-exit leader with a surviving same-group descendant fails and is cleaned", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX process-group regression");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-descendant-leak-test-"));
  const pidPath = path.join(root, "descendant.pid");
  const parentSource = [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
    "child.unref();",
  ].join(" ");
  try {
    await assert.rejects(
      runCommand([process.execPath, "-e", parentSource], {
        cwd: root,
        timeoutMs: 5_000,
      }),
      /owned process group remained/,
    );
    const pid = Number(await readFile(pidPath, "utf8"));
    assert.equal(await isProcessLive(pid), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("command abort during diagnostics setup cannot race into a spawn", async () => {
  const controller = new AbortController();
  let spawned = false;
  await assert.rejects(
    runCommand(["never-spawn"], {
      cwd: "/tmp",
      logPath: "/tmp/never-created.log",
      signal: controller.signal,
      prepareLogDirectory: async () => {
        controller.abort(new Error("received SIGINT"));
      },
      spawnProcess: () => {
        spawned = true;
        throw new Error("unexpected spawn");
      },
    }),
    /received SIGINT/,
  );
  assert.equal(spawned, false);
});

test("diagnostic stream failures are awaited and terminate the command", async () => {
  const failingLog = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("synthetic disk failure"));
    },
  });
  await assert.rejects(
    runCommand(
      [
        process.execPath,
        "-e",
        "process.stdout.write('trigger log write\\n'); setInterval(() => {}, 1000)",
      ],
      {
        cwd: "/tmp",
        logPath: "/tmp/injected-log-path.log",
        timeoutMs: 5_000,
        terminationGraceMs: 25,
        closeDeadlineMs: 100,
        prepareLogDirectory: async () => {},
        createLogStream: () => failingLog,
      },
    ),
    /diagnostic log failed.*synthetic disk failure/,
  );
});

test("disposable copy includes only the supplied tracked/nonignored file list", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-copy-test-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  await mkdir(path.join(source, "nested"), { recursive: true });
  await writeFile(path.join(source, "tracked.txt"), "tracked\n");
  await writeFile(path.join(source, ".env"), "SECRET=never-copy\n");
    await writeFile(path.join(source, "nested", "working.txt"), "working\n");
    await symlink("/tmp", path.join(source, "escape-link"));

  try {
    await copyWorkspaceFiles(source, target, ["tracked.txt", "nested/working.txt"]);
    assert.equal(await readFile(path.join(target, "tracked.txt"), "utf8"), "tracked\n");
    assert.equal(await readFile(path.join(target, "nested", "working.txt"), "utf8"), "working\n");
    await assert.rejects(readFile(path.join(target, ".env"), "utf8"));
    await assert.rejects(copyWorkspaceFiles(source, target, ["../escape"]), /unsafe workspace path/);
    await assert.rejects(
      copyWorkspaceFiles(source, target, ["escape-link"]),
      /absolute workspace symlink|escapes the repository/,
    );
    const absoluteInternal = path.join(source, "absolute-internal");
    await symlink(path.join(source, "tracked.txt"), absoluteInternal);
    await assert.rejects(
      copyWorkspaceFiles(source, target, ["absolute-internal"]),
      /absolute workspace symlink/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owned artifact paths reject traversal, duplicate destinations, and symlink parents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-owned-path-test-"));
  const outside = path.join(root, "outside");
  const owned = path.join(root, "owned");
  await mkdir(outside);
  await mkdir(owned);
  await symlink(outside, path.join(owned, "escape"));
  await writeFile(path.join(owned, "present.json"), "{}\n");
  try {
    assert.equal(
      await resolveOwnedArtifactPath(owned, "nested/artifact.json"),
      path.join(await realpath(owned), "nested", "artifact.json"),
    );
    await assert.rejects(
      resolveOwnedArtifactPath(owned, "../outside.json"),
      /unsafe workspace path|unsafe owned artifact path/,
    );
    await assert.rejects(
      resolveOwnedArtifactPath(owned, "escape/artifact.json"),
      /not a safe directory/,
    );
    await assert.rejects(
      resolveOwnedArtifactPath(owned, "present.json"),
      /already exists/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency trees are isolated copies with repository-contained relative symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-dependency-clone-test-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  await mkdir(path.join(source, "node_modules", ".pnpm", "example", "node_modules", "example"), {
    recursive: true,
  });
  const sourceFile = path.join(
    source,
    "node_modules",
    ".pnpm",
    "example",
    "node_modules",
    "example",
    "index.js",
  );
  await writeFile(sourceFile, "module.exports = 'source';\n");
  await symlink(
    ".pnpm/example/node_modules/example",
    path.join(source, "node_modules", "example"),
  );
  try {
    await cloneDependencyTrees(source, target, [""]);
    const targetFile = path.join(
      target,
      "node_modules",
      ".pnpm",
      "example",
      "node_modules",
      "example",
      "index.js",
    );
    assert.notEqual((await lstat(sourceFile)).ino, (await lstat(targetFile)).ino);
    await writeFile(targetFile, "module.exports = 'target';\n");
    assert.equal(await readFile(sourceFile, "utf8"), "module.exports = 'source';\n");
    assert.equal(
      await realpath(path.join(target, "node_modules", "example")),
      await realpath(
        path.join(
          target,
          "node_modules",
          ".pnpm",
          "example",
          "node_modules",
          "example",
        ),
      ),
    );

    await symlink("../../outside", path.join(source, "node_modules", "escape"));
    await assert.rejects(
      cloneDependencyTrees(source, path.join(root, "rejected"), [""]),
      /dependency symlink escapes/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Corepack cache preparation fails closed when pnpm is not already cached", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-corepack-clone-test-"));
  const empty = path.join(root, "empty");
  const cached = path.join(root, "cached");
  const wrong = path.join(root, "wrong");
  const target = path.join(root, "target");
  await mkdir(empty);
  await mkdir(path.join(wrong, "v1", "pnpm", "10.24.0"), { recursive: true });
  await mkdir(path.join(cached, "v1", "pnpm", "10.25.0"), { recursive: true });
  await writeFile(
    path.join(cached, "v1", "pnpm", "10.25.0", "package.json"),
    '{"name":"pnpm","version":"10.25.0"}\n',
  );
  try {
    await assert.rejects(
      cloneCorepackCache(empty, target),
      /requires a cached pnpm distribution/,
    );
    await assert.rejects(
      cloneCorepackCache(wrong, target, { requiredPnpmVersion: "10.25.0" }),
      /requires cached pnpm 10\.25\.0/,
    );
    const versions = await cloneCorepackCache(cached, target, {
      requiredPnpmVersion: "10.25.0",
    });
    assert.deepEqual(versions, ["10.25.0"]);
    const sourcePackage = path.join(
      cached,
      "v1",
      "pnpm",
      "10.25.0",
      "package.json",
    );
    const targetPackage = path.join(
      target,
      "v1",
      "pnpm",
      "10.25.0",
      "package.json",
    );
    assert.notEqual((await lstat(sourcePackage)).ino, (await lstat(targetPackage)).ino);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owned temporary directory preparation is atomic on failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-owned-temp-test-"));
  try {
    await assert.rejects(
      prepareOwnedTemporaryDirectory(path.join(root, "prepared-"), async (directory) => {
        await writeFile(path.join(directory, "partial.txt"), "partial\n");
        throw new Error("preparation failed");
      }),
      /preparation failed/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owned temporary directory can hand partial ownership to bounded outer cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-owned-handoff-test-"));
  let allocated;
  try {
    await assert.rejects(
      prepareOwnedTemporaryDirectory(
        path.join(root, "prepared-"),
        async (directory) => {
          await writeFile(path.join(directory, "partial.txt"), "partial\n");
          throw new Error("preparation failed after allocation");
        },
        {
          cleanupOnFailure: false,
          onCreated(directory) {
            allocated = directory;
          },
        },
      ),
      /preparation failed after allocation/,
    );
    assert.equal(await readFile(path.join(allocated, "partial.txt"), "utf8"), "partial\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owned temporary directory hands off ownership before mode preparation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-owned-mode-handoff-test-"));
  let allocated;
  try {
    await assert.rejects(
      prepareOwnedTemporaryDirectory(
        path.join(root, "prepared-"),
        async () => assert.fail("prepare must not run after mode failure"),
        {
          cleanupOnFailure: false,
          onCreated(directory) {
            allocated = directory;
          },
          async setPrivateMode() {
            throw new Error("injected chmod failure");
          },
        },
      ),
      /injected chmod failure/,
    );
    assert.equal((await lstat(allocated)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitized JSON records replace atomically with private mode and no stale temp file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-atomic-json-test-"));
  const target = path.join(root, "lifecycle.json");
  try {
    await writeSanitizedJson(target, { revision: 1 });
    await writeSanitizedJson(target, { revision: 2 });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { revision: 2 });
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".tmp-")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lifecycle serialization preserves control fields while redacting colliding canaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-lifecycle-redaction-test-"));
  const canaries = ["admin", "database", "passed", "postgres"];
  try {
    const journal = await createResourceLifecycleJournal(root, { canaries });
    await journal.acquiring({
      id: "administration",
      type: "external-administration",
      owned: false,
      identity: { source: "admin database passed postgres" },
      recovery: {
        instruction: "admin database passed postgres",
      },
    });
    await journal.acquired("administration");
    await journal.cleanupFinished("administration", {
      status: "not-owned",
      error: new Error("admin database passed postgres"),
    });
    await journal.acquiring({
      id: "database",
      type: "owned-test-database",
      owned: true,
      identity: { name: "database", password: "postgres" },
      recovery: "admin must remove database after passed",
    });
    await journal.acquired("database");
    await journal.cleanupFinished("database", { status: "removed" });
    await journal.finish(
      "passed",
      new Error("admin database passed postgres"),
    );

    const persisted = JSON.parse(await readFile(journal.filePath, "utf8"));
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persisted.status, "passed");
    assert.deepEqual(
      persisted.resources.map(({ id, type, owned, status, cleanup }) => ({
        id,
        type,
        owned,
        status,
        cleanup: cleanup.status,
      })),
      [
        {
          id: "administration",
          type: "external-administration",
          owned: false,
          status: "acquired",
          cleanup: "not-owned",
        },
        {
          id: "database",
          type: "owned-test-database",
          owned: true,
          status: "acquired",
          cleanup: "removed",
        },
      ],
    );
    const dynamicEvidence = JSON.stringify(
      resourceLifecycleDynamicValues(persisted),
    );
    for (const canary of canaries) {
      assert.equal(dynamicEvidence.includes(canary), false, canary);
    }
    assert.equal((await lstat(journal.filePath)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caller integrity detects changes on both success and failure paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-integrity-test-"));
  const present = path.join(root, "schema.gql");
  const absent = path.join(root, "generated.ts");
  await writeFile(present, "type Query { ok: Boolean! }\n");
  try {
    const before = await captureCallerIntegrity([present, absent]);
    await assert.doesNotReject(assertCallerIntegrity(before));
    await writeFile(present, "changed\n");
    await assert.rejects(assertCallerIntegrity(before), /caller path changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace copying and caller-integrity hashing honor cancellation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmbg-cancelled-fs-test-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  await mkdir(source);
  await writeFile(path.join(source, "tracked.txt"), "tracked\n");
  const controller = new AbortController();
  controller.abort(new Error("bounded filesystem work cancelled"));
  try {
    await assert.rejects(
      copyWorkspaceFiles(source, target, ["tracked.txt"], {
        signal: controller.signal,
      }),
      /bounded filesystem work cancelled/,
    );
    await assert.rejects(
      captureCallerIntegrity([path.join(source, "tracked.txt")], {
        signal: controller.signal,
      }),
      /bounded filesystem work cancelled/,
    );
    await assert.rejects(
      assertCallerIntegrity(
        new Map([[path.join(source, "tracked.txt"), { exists: true }]]),
        { signal: controller.signal },
      ),
      /bounded filesystem work cancelled/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
