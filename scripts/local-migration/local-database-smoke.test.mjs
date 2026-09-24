import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalDatabaseSmokeEnvironment,
  decodeLocalDatabaseProbe,
  assertLocalDatabaseChildResult,
} from "./local-database-smoke.mjs";

test("local database smoke requires explicit roots and excludes hosted/native/global-loader ambient settings", () => {
  const environment = buildLocalDatabaseSmokeEnvironment(
    {
      PATH: "/owned/bin",
      DATABASE_URL: "private",
      NODE_OPTIONS: "--require private",
      NODE_PATH: "/private",
      NODE_PG_FORCE_NATIVE: "1",
      GCP_PROJECT_ID: "private",
    },
    {
      home: "/owned/home",
      temporaryDirectory: "/owned/tmp",
      databaseRoot: "/owned/data",
      stateRoot: "/owned/identity",
      runtimeDist: "/owned/dist",
    },
  );
  assert.equal(environment.PATH, "/owned/bin");
  assert.equal(environment.LOCAL_DATABASE_ROOT, "/owned/data");
  assert.equal(environment.LOCAL_IDENTITY_STATE_ROOT, "/owned/identity");
  for (const key of [
    "DATABASE_URL",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_PG_FORCE_NATIVE",
    "GCP_PROJECT_ID",
  ])
    assert.equal(environment[key], undefined);
});
test("probe evidence is closed, bounded, exact-runtime and carries no credential or row payload", () => {
  const record = {
    type: "context-router.local-database.probe",
    version: 1,
    target: "a".repeat(43),
    principal: "b".repeat(43),
    catalog: 19,
    catalogDigest: "1".repeat(64),
    dataDigest: "2".repeat(64),
    preferences: 1,
    node: "24.21.0",
    sqlite: "3.53.4",
    sourceId: "source",
    compileOptionsDigest: "3".repeat(64),
  };
  assert.deepEqual(
    decodeLocalDatabaseProbe(JSON.stringify(record) + "\n"),
    record,
  );
  for (const changed of [
    { ...record, credential: "private" },
    { ...record, catalog: 0 },
    { ...record, node: "wrong" },
    { ...record, sqlite: "3.51.2" },
    { ...record, preferences: 0 },
    { ...record, dataDigest: "invalid" },
  ])
    assert.throws(() =>
      decodeLocalDatabaseProbe(JSON.stringify(changed) + "\n"),
    );
  assert.throws(() =>
    decodeLocalDatabaseProbe(JSON.stringify(record) + "\nextra"),
  );
});

test("captured output violations have fixed diagnostics before any dynamic credential canary exists", () => {
  const good = {
    code: 0,
    signal: null,
    overflow: false,
    stderr: "",
    stdout: "expected\n",
  };
  assertLocalDatabaseChildResult(good, 0, "expected\n");
  for (const bad of [
    { ...good, stdout: "credential-private-canary" },
    { ...good, stderr: "credential-private-canary" },
    { ...good, overflow: true },
  ])
    assert.throws(
      () => assertLocalDatabaseChildResult(bad, 0, "expected\n"),
      (error) => {
        assert.equal(
          error.message,
          "Local database smoke child fixed output contract failed",
        );
        assert.doesNotMatch(String(error), /credential-private-canary/);
        return true;
      },
    );
});

import { assertLocalDatabaseSmokeSuccessResources } from "./local-database-lifecycle.mjs";
import { localDatabaseLifecycleResources } from "./fixtures/local-database-lifecycle.mjs";
test("SQLite lifecycle requires its full exact resource census, stable engine/state and PID-bound cleanup proof", () => {
  const valid = { resources: localDatabaseLifecycleResources("/owned") };
  assertLocalDatabaseSmokeSuccessResources(valid, "fixture");
  const mutate = [
    (s) => s.resources.pop(),
    (s) => s.resources.push(structuredClone(s.resources[0])),
    (s) => s.resources.push({ ...s.resources[0], id: "local-database-rogue" }),
    (s) => {
      s.resources[1].type = "unknown";
    },
    (s) => {
      s.resources[1].owned = false;
    },
    (s) => {
      s.resources[0].cleanup.status = "failed";
    },
    ...[
      "initialized",
      "principalStable",
      "credentialRotated",
      "recoveryStable",
      "dataStable",
    ].map((key) => (s) => {
      s.resources[0].identity[key] = false;
    }),
    ...[
      "generation",
      "catalogCount",
      "providerBindings",
      "node",
      "sqlite",
      "compileOptionsDigest",
    ].map((key) => (s) => {
      s.resources[0].identity[key] = "wrong";
    }),
    (s) => {
      s.resources[0].recovery.root = "relative";
    },
    (s) => {
      s.resources[0].recovery.databaseRoot = "/different/data";
    },
    (s) => {
      s.resources[0].recovery.instruction = "delete";
    },
    (s) => {
      s.resources[0].identity.stateRoot = "/different/identity";
    },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => [
      (s) => {
        s.resources[i].identity.pid = 0;
      },
      (s) => {
        s.resources[i].recovery.processGroupId++;
      },
      (s) => {
        s.resources[i].identity.exitCode = -1;
      },
      (s) => {
        s.resources[i].identity.childSignal = "SIGKILL";
      },
    ]),
    (s) => {
      s.resources[5].identity.listenerCount = 1;
    },
    (s) => {
      delete s.resources[6].identity.readinessVersion;
    },
    (s) => {
      s.resources[6].identity.requestedSignal = "SIGTERM";
    },
    (s) => {
      s.resources[4].identity.operation = "initialize";
    },
    (s) => {
      s.resources[7].identity.operation = "inspect";
    },
  ];
  for (const change of mutate) {
    const state = structuredClone(valid);
    change(state);
    assert.throws(
      () => assertLocalDatabaseSmokeSuccessResources(state, "fixture"),
      /local-database/,
    );
  }
});

import {
  mkdtemp,
  mkdir,
  realpath,
  writeFile,
  readdir,
  readFile,
  symlink,
  lstat,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createResourceLifecycleJournal } from "./gate-runner.mjs";
import { runLocalDatabaseSmoke } from "./local-database-smoke.mjs";
import { terminateAndReapJournaledNodeChild } from "./local-identity-smoke.mjs";
test("SQLite smoke rejects an unavailable parent with a fixed error before acquisition", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "sqlite-smoke-unavailable-parent-")),
  );
  t.after(() => rm(root, { recursive: true }));
  let acquisitions = 0;
  await assert.rejects(
    runLocalDatabaseSmoke({
      stateParent: path.join(root, "private-path-canary"),
      journal: {
        acquiring() {
          acquisitions++;
        },
      },
    }),
    (error) =>
      error.message === "Local database smoke state parent unavailable",
  );
  assert.equal(acquisitions, 0);
  assert.deepEqual(await readdir(root), []);
});
test("SQLite smoke resolves its owned parent alias before child configuration and cleanup ownership", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "sqlite-smoke-parent-alias-")),
  );
  let removed = false;
  t.after(async () => {
    if (removed) await rm(root, { recursive: true });
  });
  const parent = path.join(root, "owned-parent");
  const alias = path.join(root, "parent-alias");
  const diagnostics = path.join(root, "diagnostics");
  await mkdir(parent, { mode: 0o700 });
  await mkdir(diagnostics, { mode: 0o700 });
  await symlink(parent, alias, "dir");
  await writeFile(path.join(parent, "preserved-sibling"), "unchanged", {
    mode: 0o600,
  });
  const entrypoint = path.join(root, "entry.cjs");
  await writeFile(
    entrypoint,
    `exports.runLocalIdentityEntrypoint=async()=>{
      require('node:fs').writeFileSync(require('node:path').join(process.env.HOME,'observed.json'),JSON.stringify({databaseRoot:process.env.LOCAL_DATABASE_ROOT,stateRoot:process.env.LOCAL_IDENTITY_STATE_ROOT}),{mode:0o600});
      process.stdout.write('fixture fixed-output failure');
    };\n`,
    { mode: 0o600 },
  );
  const journal = await createResourceLifecycleJournal(diagnostics);
  await assert.rejects(
    runLocalDatabaseSmoke({
      entrypoint,
      cwd: root,
      home: path.join(root, "home"),
      temporaryDirectory: path.join(root, "tmp"),
      stateParent: alias,
      journal,
    }),
    /Local database smoke child fixed output contract failed/,
  );
  const state = journal.state.resources.find(
    ({ id }) => id === "local-database-state",
  );
  const child = journal.state.resources.find(
    ({ id }) => id === "local-database-admin-1",
  );
  removed =
    state.cleanup.status === "removed" && child.cleanup.status === "exited";
  assert.equal(removed, true);
  assert.throws(() => process.kill(child.identity.pid, 0), { code: "ESRCH" });
  const observed = JSON.parse(
    await readFile(path.join(root, "home", "observed.json"), "utf8"),
  );
  assert.equal(path.dirname(state.identity.root), parent);
  for (const key of ["databaseRoot", "stateRoot"]) {
    assert.equal(observed[key], state.identity[key]);
    assert.equal(state.recovery[key], state.identity[key]);
    assert.equal(path.dirname(observed[key]), state.identity.root);
  }
  assert.equal(state.recovery.root, state.identity.root);
  assert.deepEqual(await readdir(parent), ["preserved-sibling"]);
  assert.equal(
    await readFile(path.join(parent, "preserved-sibling"), "utf8"),
    "unchanged",
  );
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
});
for (const mode of [
  "fixed-output-failure",
  "cancel-owned-child",
  "retry-owned-cleanup",
]) {
  test(`SQLite smoke ${mode} reaps its recorded child before removing owned state`, async (t) => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "sqlite-smoke-failure-")),
    );
    let removed = false;
    t.after(async () => {
      if (removed) await rm(root, { recursive: true, force: true });
    });
    const diagnostics = path.join(root, "diagnostics");
    await mkdir(diagnostics, { mode: 0o700 });
    const entrypoint = path.join(root, "entry.cjs");
    await writeFile(
      entrypoint,
      mode === "fixed-output-failure"
        ? "exports.runLocalIdentityEntrypoint=async()=>{process.stdout.write('credential-private-canary');};\n"
        : "exports.runLocalIdentityEntrypoint=async()=>{await new Promise(()=>{});};\n",
      { mode: 0o600 },
    );
    const journal = await createResourceLifecycleJournal(diagnostics);
    let terminationAttempts = 0;
    const cancellation = new AbortController();
    const acquired = journal.acquired.bind(journal);
    journal.acquired = async (id, evidence) => {
      await acquired(id, evidence);
      if (
        mode !== "fixed-output-failure" &&
        id === "local-database-admin-1" &&
        evidence?.identity?.pid
      )
        cancellation.abort(new Error("owned fixture cancellation"));
    };
    await assert.rejects(
      runLocalDatabaseSmoke({
        entrypoint,
        cwd: root,
        home: path.join(root, "home"),
        temporaryDirectory: path.join(root, "tmp"),
        stateParent: root,
        journal,
        signal: cancellation.signal,
        terminateChild: async (...args) => {
          terminationAttempts++;
          if (mode === "retry-owned-cleanup" && terminationAttempts === 1)
            return [new Error("fixture first cleanup failure")];
          return terminateAndReapJournaledNodeChild(...args);
        },
      }),
      (error) => {
        assert.doesNotMatch(String(error), /credential-private-canary/);
        if (mode === "retry-owned-cleanup")
          assert.match(String(error), /fixture first cleanup failure/);
        return true;
      },
    );
    await journal.finish("failed");
    removed = !journal.state.resources.some(
      (resource) =>
        resource.id === "local-database-state" &&
        resource.cleanup.status !== "removed",
    );
    if (mode === "retry-owned-cleanup") assert.equal(terminationAttempts, 2);
    assert.equal(
      journal.state.resources.find(
        (resource) => resource.id === "local-database-state",
      ).cleanup.status,
      "removed",
    );
    const child = journal.state.resources.find(
      (resource) => resource.id === "local-database-admin-1",
    );
    assert.equal(child.cleanup.status, "exited");
    assert.equal(child.recoveryRequired, false);
    assert.ok(Number.isInteger(child.identity.pid));
    assert.throws(() => process.kill(child.identity.pid, 0), { code: "ESRCH" });
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith("local-database-")),
      false,
    );
  });
}
