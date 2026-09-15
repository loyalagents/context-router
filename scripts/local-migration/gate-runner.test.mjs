import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCallerIntegrity,
  assertSafePostgresEndpoint,
  assertServerVerifiedTestDatabase,
  captureCallerIntegrity,
  copyWorkspaceFiles,
  createStreamingRedactor,
  redactSecrets,
  runCommand,
  runPhaseSequence,
  validateGeneratedDatabaseName,
  validateMergeBase,
  validatePhaseManifest,
} from "./gate-runner.mjs";

const fullSha = "0123456789abcdef0123456789abcdef01234567";

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
    return { exitCode: 0, stdout: "" };
  };
  assert.equal(await validateMergeBase(fullSha, git), fullSha);
  assert.deepEqual(calls, [
    ["cat-file", "-e", `${fullSha}^{commit}`],
    ["merge-base", "--is-ancestor", fullSha, "HEAD"],
  ]);

  await assert.rejects(validateMergeBase("deadbeef", git), /full 40-character/);
  await assert.rejects(validateMergeBase("0".repeat(40), git), /zero SHA/);
  await assert.rejects(
    validateMergeBase(fullSha, async () => ({ exitCode: 1, stdout: "" })),
    /not available as a commit/,
  );
  let count = 0;
  await assert.rejects(
    validateMergeBase(fullSha, async () => ({
      exitCode: ++count === 1 ? 0 : 1,
      stdout: "",
    })),
    /not an ancestor/,
  );
});

test("phase manifest requires owned ordered lifecycle metadata and a smoke for every supported mode", () => {
  const valid = {
    schemaVersion: 1,
    supportedModes: ["hosted-baseline"],
    phases: [
      {
        id: "contracts",
        order: 1,
        ownerStep: "01",
        status: "active",
        timeoutMs: 1000,
        modes: ["hosted-baseline"],
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
  retiredSmoke.phases[1].replacementEvidence = ["successor-smoke-evidence"];
  assert.ok(
    validatePhaseManifest(retiredSmoke).some((item) => item.includes("restart smoke")),
  );

  const invalidLifecycle = structuredClone(valid);
  invalidLifecycle.phases[0].ownerStep = "99";
  invalidLifecycle.phases[0].modes = ["unknown-mode"];
  invalidLifecycle.phases[0].status = "retired";
  invalidLifecycle.phases[0].replacementEvidence = [];
  invalidLifecycle.phases[0].timeoutMs = 0;
  const lifecycleErrors = validatePhaseManifest(invalidLifecycle);
  assert.ok(lifecycleErrors.some((item) => item.includes("roadmap owner")));
  assert.ok(lifecycleErrors.some((item) => item.includes("unknown mode")));
  assert.ok(lifecycleErrors.some((item) => item.includes("retired") && item.includes("replacement")));
  assert.ok(lifecycleErrors.some((item) => item.includes("timeout")));
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
      /escapes the repository/,
    );
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
