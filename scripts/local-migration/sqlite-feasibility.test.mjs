import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  APP_ID,
  MAGIC,
  createDatabase,
  openExisting,
  preflight,
  recoverBootstrap,
  closeOwned,
} from "./fixtures/sqlite-feasibility/database.mjs";
import { installLike } from "./fixtures/sqlite-feasibility/like.mjs";

// CP1 deliberately exercises representative mechanisms, not the production adapter.
// All roots and processes belong to one test; no live credentials or server inputs.
const exec = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(directory, "fixtures/sqlite-feasibility/process.mjs");
const require = createRequire(
  new URL("../../apps/backend/package.json", import.meta.url),
);
const uid = process.getuid();
const cleanups = new WeakMap();
process.umask(0o077);

function owned(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "step05-sqlite-probe-")),
  );
  fs.chmodSync(root, 0o700);
  const resources = [];
  cleanups.set(t, resources);
  t.after(async () => {
    const failures = [];
    for (const cleanup of resources.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      closeOwned(root);
    } catch (error) {
      failures.push(error);
    }
    // Preserve the private root if any resource close/reap is uncertain.
    if (failures.length)
      throw new AggregateError(
        failures,
        `Probe cleanup failed; preserved ${root}`,
      );
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false);
  });
  return root;
}
function ownConnection(t, connection) {
  cleanups.get(t).push(() => {
    if (connection.isOpen) connection.close();
  });
  return connection;
}
function at(root, name) {
  const value = path.join(root, name);
  fs.mkdirSync(value, { mode: 0o700 });
  return path.join(value, "database.sqlite");
}
function bytes(paths) {
  return paths.map((value) => fs.readFileSync(value).toString("base64"));
}
function syncPath(value) {
  const descriptor = fs.openSync(value, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
function child(t, command, dbPath, extra = {}) {
  const instance = fork(fixture, [command, dbPath], {
    execPath: process.execPath,
    execArgv: ["--no-global-search-paths"],
    env: { PATH: path.dirname(process.execPath), ...extra },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  instance.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve) =>
    instance.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const message = new Promise((resolve, reject) => {
    instance.once("message", resolve);
    instance.once("error", reject);
    instance.once("exit", () =>
      reject(new Error(`Probe exited before message: ${stderr}`)),
    );
  });
  cleanups.get(t).push(async () => {
    if (instance.exitCode === null && instance.signalCode === null)
      instance.kill("SIGKILL");
    await exit;
    assert.equal(stderr, "");
  });
  return { instance, exit, message };
}

test("pinned runtime exports SQLite and existing-only URI without ambient or warning dependency", async (t) => {
  assert.equal(process.version, "v24.21.0");
  const root = owned(t);
  const dbPath = at(root, "runtime");
  const { target } = createDatabase(dbPath);
  const db = openExisting(dbPath, target);
  const engine = db
    .prepare("SELECT sqlite_version() version, sqlite_source_id() source")
    .get();
  const options = db
    .prepare("PRAGMA compile_options")
    .all()
    .map((row) => row.compile_options);
  assert.equal(engine.version, "3.53.4");
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "delete");
  assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
  assert.equal(db.prepare("PRAGMA trusted_schema").get().trusted_schema, 0);
  assert.equal(db.prepare("PRAGMA temp_store").get().temp_store, 2);
  assert.equal(typeof db.enableDefensive, "function");
  db.enableDefensive(true);
  db.exec("PRAGMA writable_schema=ON");
  assert.throws(() =>
    db.exec("DELETE FROM sqlite_schema WHERE name='never-present'"),
  );
  assert.throws(() => db.enableLoadExtension(true));
  assert.equal(db.location(), dbPath);
  db.close();
  t.diagnostic(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ...engine,
      options,
    }),
  );
  const missing = path.join(path.dirname(dbPath), "absent.sqlite");
  assert.throws(
    () => new DatabaseSync(`${pathToFileURL(missing).href}?mode=rw`),
  );
  assert.equal(fs.existsSync(missing), false);
  const result = await exec(
    process.execPath,
    [
      "--no-global-search-paths",
      "-e",
      "require('node:sqlite');process.stdout.write('loaded\\n')",
    ],
    {
      cwd: root,
      env: { PATH: path.dirname(process.execPath) },
    },
  );
  assert.equal(result.stdout, "loaded\n");
  assert.equal(result.stderr, "");
});

test("pre-open unsafe, empty and incompatible admission preserves bytes and settings", (t) => {
  const root = owned(t);
  for (const kind of [
    "foreign",
    "future",
    "zero",
    "corrupt",
    "target",
    "schema",
  ]) {
    const dbPath = at(root, kind);
    let expected = "x".repeat(43);
    if (kind === "zero" || kind === "corrupt")
      fs.writeFileSync(dbPath, kind === "zero" ? "" : Buffer.alloc(512, 97), {
        mode: 0o600,
      });
    else {
      const { target } = createDatabase(dbPath);
      if (kind !== "target") expected = target;
      const db = ownConnection(t, new DatabaseSync(dbPath));
      if (kind === "foreign")
        db.exec("PRAGMA application_id=777; PRAGMA journal_mode=PERSIST");
      if (kind === "future") db.exec("PRAGMA user_version=2");
      if (kind === "schema") db.exec("CREATE TABLE unknown(value TEXT)");
      db.close();
    }
    const before = bytes([dbPath]);
    assert.throws(() => openExisting(dbPath, expected));
    assert.deepEqual(bytes([dbPath]), before);
    if (kind === "zero") {
      const journal = `${dbPath}-journal`;
      fs.writeFileSync(journal, Buffer.alloc(512, 1), { mode: 0o600 });
      const withJournal = bytes([dbPath, journal]);
      assert.throws(() => openExisting(dbPath));
      assert.deepEqual(bytes([dbPath, journal]), withJournal);
    }
  }
  const dbPath = at(root, "unsafe");
  createDatabase(dbPath);
  const outside = path.join(root, "outside");
  fs.writeFileSync(outside, "unchanged", { mode: 0o600 });
  fs.symlinkSync(outside, `${dbPath}-journal`);
  assert.throws(() => preflight(dbPath));
  assert.equal(fs.readFileSync(outside, "utf8"), "unchanged");
  fs.unlinkSync(`${dbPath}-journal`);
  fs.linkSync(outside, `${dbPath}-journal`);
  assert.throws(() => preflight(dbPath));
  fs.unlinkSync(`${dbPath}-journal`);
  fs.chmodSync(dbPath, 0o644);
  assert.throws(() => preflight(dbPath));
  fs.chmodSync(dbPath, 0o600);
});

test("real file-backed JSON/null/date, constraints, partial index and declaration ordering", (t) => {
  const dbPath = at(owned(t), "semantics");
  createDatabase(dbPath);
  const db = openExisting(dbPath);
  try {
    db.exec("INSERT INTO users VALUES ('user','initial')");
    const insert = db.prepare(
      "INSERT INTO items(id,user_id,slug,value,evidence,at,action) VALUES(?,?,?,?,?,?,?)",
    );
    const when = new Date("2026-09-23T00:00:00.123Z");
    insert.run(
      "one",
      "user",
      "case",
      JSON.stringify(null),
      null,
      when.getTime(),
      "READ",
    );
    insert.run(
      "two",
      "user",
      "CASE",
      JSON.stringify({ nested: [false, 0, "", null] }),
      "null",
      when.getTime(),
      "DEFINE",
    );
    const rows = db.prepare("SELECT * FROM items ORDER BY id").all();
    assert.equal(rows[0].value, "null");
    assert.equal(rows[0].evidence, null);
    assert.equal(rows[1].evidence, "null");
    assert.deepEqual(JSON.parse(rows[1].value), {
      nested: [false, 0, "", null],
    });
    assert.deepEqual(new Date(rows[0].at), when);
    assert.throws(
      () => insert.run("three", "user", "case", "{}", null, 1, "READ"),
      (error) => error.errcode === 2067,
    );
    db.exec("UPDATE items SET archived=1 WHERE id='one'");
    insert.run("three", "user", "case", "{}", null, 1, "WRITE");
    insert.run("four", "user", "four", "{}", null, 1, "SUGGEST");
    assert.throws(
      () => insert.run("bad", "absent", "bad", "{}", null, 1, "READ"),
      (error) => error.errcode === 787,
    );
    assert.throws(
      () => insert.run("bad", "user", "bad", "{}", null, 1, "INVALID"),
      (error) => error.errcode === 275,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT action FROM items ORDER BY CASE action WHEN 'READ' THEN 0 WHEN 'SUGGEST' THEN 1 WHEN 'WRITE' THEN 2 ELSE 3 END",
        )
        .all()
        .map((row) => row.action),
      ["READ", "SUGGEST", "WRITE", "DEFINE"],
    );
    db.exec("DELETE FROM users");
    assert.equal(db.prepare("SELECT count(*) n FROM items").get().n, 0);
  } finally {
    db.close();
  }
});

test("explicit async transaction retains rejection values, expires facets before COMMIT and rolls back late failure", async (t) => {
  const dbPath = at(owned(t), "transaction");
  createDatabase(dbPath);
  let attempts = 0;
  async function transaction(callback, beforeCommit = () => {}) {
    const db = openExisting(dbPath);
    let active = true;
    const scope = Object.freeze({
      write: async (id) => {
        if (!active) throw new Error("expired");
        db.prepare("INSERT INTO users VALUES (?, 'synthetic')").run(id);
      },
    });
    try {
      attempts++;
      db.exec("BEGIN IMMEDIATE");
      let result;
      try {
        result = await callback(scope);
      } finally {
        active = false;
      }
      await beforeCommit(scope);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  }
  for (const failure of [
    undefined,
    null,
    NaN,
    { code: "ERR_SQLITE_ERROR", errcode: 2067 },
  ]) {
    let captured;
    let rejected = false;
    try {
      await transaction(async (scope) => {
        captured = scope;
        await scope.write("rollback");
        throw failure;
      });
    } catch (error) {
      rejected = true;
      assert.ok(Object.is(error, failure));
    }
    assert.ok(rejected);
    await assert.rejects(captured.write("late"), /expired/);
  }
  let acknowledged = false;
  const result = await transaction(
    async (scope) => {
      await scope.write("committed");
      return 7;
    },
    async (scope) => {
      assert.equal(Object.isFrozen(scope), true);
      await assert.rejects(scope.write("late"), /expired/);
      const outsider = openExisting(dbPath);
      assert.equal(outsider.prepare("SELECT count(*) n FROM users").get().n, 0);
      assert.throws(
        () => outsider.exec("INSERT INTO users VALUES('outside','outside')"),
        (error) => error.errcode === 5,
      );
      outsider.close();
      acknowledged = true;
    },
  );
  assert.equal(result, 7);
  assert.equal(acknowledged, true);
  const db = openExisting(dbPath);
  assert.deepEqual(
    db
      .prepare("SELECT id FROM users")
      .all()
      .map((row) => row.id),
    ["committed"],
  );
  db.close();
  assert.equal(attempts, 5);
});

async function hotJournal(t, root, name) {
  const dbPath = at(root, name);
  createDatabase(dbPath);
  const db = openExisting(dbPath);
  db.exec("BEGIN");
  const insert = db.prepare("INSERT INTO bulk(value) VALUES(?)");
  for (let i = 0; i < 200; i++) insert.run(Buffer.alloc(4096, 65));
  db.exec("COMMIT");
  db.close();
  const writer = child(t, "hot", dbPath);
  assert.deepEqual(await writer.message, { ready: "hot" });
  writer.instance.kill("SIGKILL");
  assert.equal((await writer.exit).signal, "SIGKILL");
  assert.equal(
    fs.readFileSync(`${dbPath}-journal`).subarray(0, 8).equals(MAGIC),
    true,
  );
  return dbPath;
}

test(
  "killed writer produces real hot journal; engine restores committed data without identity mutation",
  { timeout: 20_000 },
  async (t) => {
    const root = owned(t);
    const dbPath = await hotJournal(t, root, "hot");
    const identity = path.join(root, "identity.json");
    fs.writeFileSync(identity, '{"synthetic":"unchanged"}\n', { mode: 0o600 });
    const beforeIdentity = bytes([identity]);
    const db = openExisting(dbPath);
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM bulk WHERE value=?")
        .get(Buffer.alloc(4096, 65)).n,
      200,
    );
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    db.close();
    assert.equal(fs.existsSync(`${dbPath}-journal`), false);
    assert.deepEqual(bytes([identity]), beforeIdentity);
  },
);

function addReference(dbPath, reference, { invalidChecksum = false } = {}) {
  const name = Buffer.from(reference);
  const footer = Buffer.alloc(20 + name.length);
  footer.writeUInt32BE(0x40000001, 0);
  name.copy(footer, 4);
  footer.writeUInt32BE(name.length, 4 + name.length);
  footer.writeUInt32BE(
    name.reduce((sum, byte) => sum + (byte > 127 ? byte - 256 : byte), 0) +
      (invalidChecksum ? 1 : 0),
    8 + name.length,
  );
  MAGIC.copy(footer, 12 + name.length);
  fs.appendFileSync(`${dbPath}-journal`, footer);
}

test(
  "embedded super-journal references reject before replay; unguarded control proves real off-root recognition",
  { timeout: 30_000 },
  async (t) => {
    const root = owned(t);
    for (const variant of ["valid", "invalid-checksum", "relative"]) {
      const dbPath = await hotJournal(t, root, variant);
      const outside = path.join(root, `${variant}-super`);
      const identity = path.join(root, `${variant}-identity`);
      fs.writeFileSync(outside, `${dbPath}-journal\0`, { mode: 0o600 });
      fs.writeFileSync(identity, "synthetic-private-state", { mode: 0o600 });
      addReference(
        dbPath,
        variant === "relative" ? `../${path.basename(outside)}` : outside,
        { invalidChecksum: variant === "invalid-checksum" },
      );
      const files = [dbPath, `${dbPath}-journal`, outside, identity];
      const before = bytes(files);
      assert.throws(() => openExisting(dbPath), /Journal admission rejected/);
      assert.deepEqual(bytes(files), before);
      if (variant === "valid") {
        // Only this deliberately unsafe disposable control bypasses the guard.
        // A missing referenced super-journal means committed: SQLite skips rollback.
        fs.unlinkSync(outside);
        const unguarded = ownConnection(
          t,
          new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=rw`),
        );
        const changed = unguarded
          .prepare("SELECT count(*) n FROM bulk WHERE value=zeroblob(4096)")
          .get().n;
        unguarded.close();
        assert.ok(
          changed > 0,
          "SQLite followed the missing external reference and skipped hot rollback of spilled pages",
        );
        t.diagnostic(
          JSON.stringify({
            superJournalRecognition: "missing-reference-skips-rollback",
            spilledRows: changed,
          }),
        );
        assert.deepEqual(bytes([identity]), [before[3]]);
      }
    }
  },
);

test(
  "bootstrap commit/crash and pre-acquire recovery reach complete stage and closed hardlink pair only",
  { timeout: 20_000 },
  async (t) => {
    const root = owned(t);
    for (const boundary of ["before", "after", "linked"]) {
      const canonical = at(root, boundary);
      const instance = child(t, `bootstrap-${boundary}`, canonical);
      assert.deepEqual(await instance.message, { ready: boundary });
      instance.instance.kill("SIGKILL");
      await instance.exit;
      if (boundary === "before") {
        const stage = path.join(
          path.dirname(canonical),
          "bootstrap-probe.sqlite",
        );
        const files = fs
          .readdirSync(path.dirname(canonical))
          .map((name) => path.join(path.dirname(canonical), name));
        const before = bytes(files);
        assert.throws(() => recoverBootstrap(canonical));
        assert.deepEqual(bytes(files), before);
        assert.equal(fs.existsSync(stage), true);
      } else {
        const result = recoverBootstrap(canonical);
        assert.equal(result, "recovered");
        assert.equal(fs.lstatSync(canonical).nlink, 1);
        const db = openExisting(canonical);
        assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 0);
        db.close();
        assert.deepEqual(fs.readdirSync(path.dirname(canonical)), [
          "database.sqlite",
        ]);
      }
    }
  },
);

test("12 async exact-identity requests preserve five attempts with one scheduling yield per UoW attempt", async (t) => {
  const dbPath = at(owned(t), "convergence");
  createDatabase(dbPath);
  const attempts = [];
  async function oneAttempt() {
    await new Promise((resolve) => setImmediate(resolve));
    const db = openExisting(dbPath);
    let active = true;
    const guard =
      (method) =>
      async (...args) => {
        if (!active) throw new Error("expired");
        return method(...args);
      };
    const identity = Object.freeze({
      findExact: guard(async () =>
        db
          .prepare(
            "SELECT user_id FROM identities WHERE provider='p' AND issuer='i' AND subject='s'",
          )
          .get(),
      ),
      createPrincipal: guard(async (principal) =>
        db.prepare("INSERT INTO users VALUES(?, 'synthetic')").run(principal),
      ),
      createVerifiedBinding: guard(async (principal) =>
        db
          .prepare("INSERT INTO identities VALUES('p','i','s',?)")
          .run(principal),
      ),
    });
    const resolveInTransaction = async (scope) => {
      const found = await scope.identity.findExact();
      if (found) return found.user_id;
      const principal = randomBytes(32).toString("base64url");
      await scope.identity.createPrincipal(principal);
      await scope.identity.createVerifiedBinding(principal);
      return principal;
    };
    try {
      db.exec("BEGIN IMMEDIATE");
      let result;
      try {
        result = await resolveInTransaction(Object.freeze({ identity }));
      } finally {
        active = false;
      }
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  }
  async function resolve(index) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const result = await oneAttempt();
        attempts[index] = attempt;
        return result;
      } catch (error) {
        if ((error.errcode & 255) !== 5 && error.errcode !== 2067) throw error;
        if (attempt === 5) throw new Error("Five-attempt exhaustion");
      }
    }
  }
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) => resolve(index)),
  );
  assert.ok(outcomes.every((result) => result.status === "fulfilled"));
  const identities = outcomes.map((result) => result.value);
  assert.equal(new Set(identities).size, 1);
  const db = openExisting(dbPath);
  assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM identities").get().n, 1);
  db.close();
  t.diagnostic(JSON.stringify({ identityAttempts: attempts }));
});

test(
  "compiled relocated worker holds exclusive ownership across COMMIT, backup and journal preflight",
  { timeout: 30_000 },
  async (t) => {
    const root = owned(t);
    const dbPath = at(root, "worker-db");
    const { target } = createDatabase(dbPath);
    const stage = path.join(root, "sealed-runtime");
    fs.mkdirSync(stage, { mode: 0o700 });
    await exec(
      process.execPath,
      [
        require.resolve("typescript/bin/tsc"),
        path.join(directory, "fixtures/sqlite-feasibility/worker.ts"),
        "--outDir",
        stage,
        "--target",
        "ES2022",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--types",
        "node",
        "--typeRoots",
        path.resolve(directory, "../../apps/backend/node_modules/@types"),
        "--skipLibCheck",
        "--strict",
      ],
      { cwd: root },
    );
    const codecPath = path.join(root, "compiled-codec");
    await exec(
      process.execPath,
      [
        require.resolve("typescript/bin/tsc"),
        path.resolve(
          directory,
          "../../apps/backend/src/modules/auth/local-identity-state.codec.ts",
        ),
        "--outDir",
        codecPath,
        "--target",
        "ES2022",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--types",
        "node",
        "--typeRoots",
        path.resolve(directory, "../../apps/backend/node_modules/@types"),
        "--skipLibCheck",
        "--strict",
      ],
      { cwd: root },
    );
    const codec = require(
      path.join(codecPath, "local-identity-state.codec.js"),
    );
    const material = codec.createLocalIdentityMaterial();
    const state = {
      schemaVersion: 1,
      databaseTargetId: target,
      ...material,
      generation: 1,
    };
    const identityRoot = path.join(root, "identity");
    fs.mkdirSync(identityRoot, { mode: 0o700 });
    const identityPath = path.join(identityRoot, "identity.json");
    const identityBytes = codec.encodeLocalIdentityState(state);
    fs.writeFileSync(identityPath, identityBytes, { flag: "wx", mode: 0o600 });
    const supervisor = path.join(stage, "supervisor.cjs");
    fs.writeFileSync(
      supervisor,
      `const {Worker}=require('node:worker_threads');
const w=new Worker(require('node:path').join(__dirname,'worker.js'),{workerData:{dbPath:process.argv[2],target:process.argv[3]},execArgv:['--no-global-search-paths']});
const pending=new Map(); let id=0;
w.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}});
function request(command){return new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});w.postMessage({id,command})})}
(async()=>{try{await request('acquire');await request('close');process.stdout.write('compiled-worker-ok\\n')}finally{await w.terminate()}})().catch(()=>{process.stderr.write('probe failed\\n');process.exitCode=1});
`,
      { mode: 0o600 },
    );
    const isolated = await exec(
      process.execPath,
      ["--no-global-search-paths", supervisor, dbPath, target],
      {
        cwd: root,
        timeout: 5000,
        env: {
          PATH: path.dirname(process.execPath),
          NODE_PATH: "/unavailable/global/modules",
          DATABASE_URL: "invalid-no-fallback",
          NODE_PG_FORCE_NATIVE: "1",
          HOME: root,
        },
      },
    );
    assert.equal(isolated.stdout, "compiled-worker-ok\n");
    assert.equal(isolated.stderr, "");
    const worker = new Worker(path.join(stage, "worker.js"), {
      workerData: { dbPath, target },
      execArgv: ["--no-global-search-paths"],
    });
    cleanups.get(t).push(async () => {
      await worker.terminate();
      assert.equal(worker.threadId, -1);
    });
    let id = 0;
    let lost = false;
    const pending = new Map();
    worker.on("message", (message) => {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    });
    const request = (command, values = {}, timeout = 2000) => {
      if (lost) return Promise.reject(new Error("terminal"));
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          lost = true;
          for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.reject(new Error("deadline"));
          }
          pending.clear();
          void worker.terminate();
        }, timeout);
        pending.set(requestId, { resolve, reject, timer });
        worker.postMessage({ id: requestId, command, ...values });
      });
    };
    await request("acquire");
    const excluded = async () => {
      const contender = child(t, "contend", dbPath);
      assert.deepEqual(await contender.message, {
        read: "busy",
        write: "busy",
      });
      assert.equal((await contender.exit).code, 0);
    };
    await excluded();
    await request("begin");
    assert.equal(await request("count"), 0);
    await request("insert", { principal: material.principalId });
    assert.equal(await request("count"), 1);
    // Journal-only inspection closes an FD while SQLite's main connection is held.
    preflight(dbPath);
    await excluded();
    await request("commit");
    await excluded();
    const bundle = path.join(root, "private-bundle");
    fs.mkdirSync(bundle, { mode: 0o700 });
    const snapshot = path.join(bundle, "database.sqlite");
    assert.equal(fs.existsSync(snapshot), false);
    await request("backup", { snapshot });
    fs.copyFileSync(
      identityPath,
      path.join(bundle, "identity.json"),
      fs.constants.COPYFILE_EXCL,
    );
    for (const file of [snapshot, path.join(bundle, "identity.json")]) {
      const descriptor = fs.openSync(file, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    const stageMarker = path.join(bundle, "complete.stage");
    fs.writeFileSync(stageMarker, '{"version":1}\n', {
      flag: "wx",
      mode: 0o600,
    });
    syncPath(stageMarker);
    syncPath(bundle);
    fs.linkSync(stageMarker, path.join(bundle, "complete.json"));
    syncPath(bundle);
    fs.unlinkSync(stageMarker);
    syncPath(bundle);
    await excluded();
    const restored = ownConnection(t, new DatabaseSync(snapshot));
    assert.equal(
      restored.prepare("SELECT target FROM metadata").get().target,
      target,
    );
    assert.equal(
      restored.prepare("SELECT id FROM users").get().id,
      material.principalId,
    );
    restored.close();
    await request("close");
    const fresh = openExisting(dbPath, target);
    assert.equal(fresh.prepare("SELECT count(*) n FROM users").get().n, 1);
    fresh.close();
    // Source rotation after the matching snapshot does not rewrite old backup bytes.
    const sourceGeneration2 = {
      ...state,
      credential: randomBytes(32).toString("base64url"),
      generation: 2,
    };
    fs.writeFileSync(
      identityPath,
      codec.encodeLocalIdentityState(sourceGeneration2),
    );
    const sourceAfter = bytes([dbPath, identityPath]);
    const restoreDb = at(root, "restore-db");
    const restoreIdentityRoot = path.join(root, "restore-identity");
    fs.mkdirSync(restoreIdentityRoot, { mode: 0o700 });
    fs.copyFileSync(snapshot, restoreDb, fs.constants.COPYFILE_EXCL);
    const restoreIdentity = path.join(restoreIdentityRoot, "identity.json");
    fs.copyFileSync(
      path.join(bundle, "identity.json"),
      restoreIdentity,
      fs.constants.COPYFILE_EXCL,
    );
    assert.deepEqual(fs.readFileSync(restoreIdentity), identityBytes);
    const oldState = codec.decodeLocalIdentityState(
      fs.readFileSync(restoreIdentity),
    );
    assert.equal(oldState.credential, material.credential);
    assert.notEqual(oldState.credential, sourceGeneration2.credential);
    const verifiedRestore = openExisting(restoreDb, oldState.databaseTargetId);
    assert.equal(
      verifiedRestore.prepare("SELECT id FROM users").get().id,
      oldState.principalId,
    );
    assert.equal(
      verifiedRestore.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.deepEqual(
      verifiedRestore.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
    verifiedRestore.close();
    const rotatedRestore = {
      ...oldState,
      credential: randomBytes(32).toString("base64url"),
      generation: oldState.generation + 1,
    };
    fs.writeFileSync(
      restoreIdentity,
      codec.encodeLocalIdentityState(rotatedRestore),
    );
    assert.equal(
      codec.decodeLocalIdentityState(fs.readFileSync(restoreIdentity))
        .principalId,
      material.principalId,
    );
    assert.notEqual(rotatedRestore.credential, oldState.credential);
    assert.deepEqual(bytes([dbPath, identityPath]), sourceAfter);
    await request("acquire");
    await excluded();
    await request("begin");
    await request("touch");
    const retainedCandidate = path.join(identityRoot, "probe.pending");
    fs.writeFileSync(retainedCandidate, fs.readFileSync(identityPath), {
      flag: "wx",
      mode: 0o600,
    });
    const beforeTimeoutCandidate = bytes([retainedCandidate]);
    const timeoutStarted = performance.now();
    await request("commit-and-stall", {}, 100).then(
      () => assert.fail("stall resolved"),
      (error) => assert.match(error.message, /deadline/),
    );
    assert.ok(performance.now() - timeoutStarted < 1000);
    const sent = id;
    await assert.rejects(request("count"), /terminal/);
    assert.equal(id, sent);
    // Rejected watchdog is separate from actual worker exit/lock release.
    await worker.terminate();
    const afterExit = openExisting(dbPath, target);
    assert.equal(afterExit.prepare("SELECT count(*) n FROM users").get().n, 1);
    assert.equal(
      afterExit.prepare("SELECT email FROM users").get().email,
      "committed-without-acknowledgement",
    );
    afterExit.close();
    assert.deepEqual(bytes([retainedCandidate]), beforeTimeoutCandidate);
  },
);

test(
  "stopped original process retains pre/postcommit ownership; only killed-and-reaped owner releases it",
  { timeout: 15_000 },
  async (t) => {
    const root = owned(t);
    for (const phase of ["before", "after"]) {
      const dbPath = at(root, phase);
      createDatabase(dbPath);
      const owner = child(t, `held-${phase}`, dbPath);
      assert.deepEqual(await owner.message, { ready: `held-${phase}` });
      owner.instance.kill("SIGSTOP");
      const contender = child(t, "contend", dbPath);
      assert.deepEqual(await contender.message, {
        read: "busy",
        write: "busy",
      });
      await contender.exit;
      for (const timeout of [0, 25, 250]) {
        let timerFired = false;
        const timer = setTimeout(() => {
          timerFired = true;
        }, 0);
        const db = ownConnection(
          t,
          new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=rw`, {
            timeout,
          }),
        );
        const start = performance.now();
        assert.throws(
          () => db.exec("BEGIN IMMEDIATE"),
          (error) => (error.errcode & 255) === 5,
        );
        const elapsed = performance.now() - start;
        assert.equal(
          timerFired,
          false,
          "same-thread JS timer cannot interrupt synchronous SQLite",
        );
        assert.ok(
          elapsed >= Math.max(0, timeout - 5) && elapsed < timeout + 500,
        );
        db.close();
        clearTimeout(timer);
        t.diagnostic(
          JSON.stringify({
            phase,
            busyTimeout: timeout,
            elapsed: Math.round(elapsed),
          }),
        );
      }
      owner.instance.kill("SIGKILL");
      assert.equal((await owner.exit).signal, "SIGKILL");
      const recovered = openExisting(dbPath);
      assert.equal(
        recovered.prepare("SELECT count(*) n FROM users").get().n,
        phase === "before" ? 0 : 1,
      );
      recovered.close();
    }
  },
);

test(
  "real reader blocks COMMIT after witnessed write; failed acknowledgement rolls the sole attempt back",
  { timeout: 10_000 },
  async (t) => {
    const dbPath = at(owned(t), "commit-busy");
    createDatabase(dbPath);
    const reader = child(t, "read-shared", dbPath);
    assert.deepEqual(await reader.message, { ready: "read-shared", count: 0 });
    const writer = openExisting(dbPath);
    let successes = 0;
    let attempts = 0;
    try {
      attempts++;
      writer.exec(
        "BEGIN IMMEDIATE; INSERT INTO users VALUES('pending','synthetic')",
      );
      assert.equal(writer.prepare("SELECT count(*) n FROM users").get().n, 1);
      assert.throws(
        () => {
          writer.exec("COMMIT");
          successes++;
        },
        (error) => error.errcode === 5,
      );
      assert.equal(writer.isTransaction, true);
      writer.exec("ROLLBACK");
      assert.equal(writer.isTransaction, false);
    } finally {
      writer.close();
    }
    assert.equal(successes, 0);
    assert.equal(attempts, 1);
    reader.instance.kill("SIGKILL");
    await reader.exit;
    const after = openExisting(dbPath);
    assert.equal(after.prepare("SELECT count(*) n FROM users").get().n, 0);
    after.close();
  },
);

test("bootstrap recovery preserves partial, multiple, populated and unrelated stage states", (t) => {
  const root = owned(t);
  for (const kind of ["multiple", "populated", "unrelated", "malformed"]) {
    const canonical = at(root, kind);
    const stage = path.join(path.dirname(canonical), "bootstrap-probe.sqlite");
    if (kind === "malformed")
      fs.writeFileSync(stage, Buffer.alloc(512, 1), { mode: 0o600 });
    else createDatabase(stage);
    if (kind === "multiple")
      fs.copyFileSync(
        stage,
        path.join(path.dirname(canonical), "bootstrap-other.sqlite"),
      );
    if (kind === "populated") {
      const db = openExisting(stage);
      db.exec("INSERT INTO users VALUES('existing','synthetic')");
      db.close();
    }
    if (kind === "unrelated") createDatabase(canonical);
    const files = fs
      .readdirSync(path.dirname(canonical))
      .map((name) => path.join(path.dirname(canonical), name));
    const before = bytes(files);
    assert.throws(() => recoverBootstrap(canonical));
    assert.deepEqual(bytes(files), before);
  }
});

test("private SQL predicate matches observed case-sensitive PostgreSQL LIKE prefixes without GLOB length cap", (t) => {
  const dbPath = at(owned(t), "prefix");
  createDatabase(dbPath);
  const db = openExisting(dbPath);
  try {
    installLike(db);
    db.exec("INSERT INTO users VALUES('user','synthetic')");
    const values = [
      "Case.alpha",
      "case.beta",
      "wild%literal",
      "wildXliteral",
      "wild_literal",
      "wildZliteral",
      "slash\\value",
      "slashvalue",
    ];
    const insert = db.prepare(
      "INSERT INTO items(id,user_id,slug,value,at,action) VALUES(?,'user',?,'null',0,'READ')",
    );
    for (const value of values) insert.run(value, value);
    const wild = [
      "wild%literal",
      "wildXliteral",
      "wildZliteral",
      "wild_literal",
    ];
    const observations = {
      Case: ["Case.alpha"],
      case: ["case.beta"],
      "wild%": wild,
      wild_: wild,
      "slash\\": [],
      "": [...values].sort(),
      "%": [...values].sort(),
    };
    const query = db.prepare(
      "SELECT slug FROM items WHERE storage_like(?,slug) ORDER BY slug LIMIT 100",
    );
    for (const [prefix, expected] of Object.entries(observations))
      assert.deepEqual(
        query.all(`${prefix}%`).map((row) => row.slug),
        expected,
      );
    assert.equal(query.all(`${"x".repeat(60_001)}%`).length, 0);
    assert.equal(query.all(`${"%".repeat(60_001)}%`).length, values.length);
    assert.equal(query.all(`${"*?[".repeat(20_001)}%`).length, 0);
    const long = "long".repeat(15_001);
    insert.run("long", long);
    assert.deepEqual(
      query.all(`${long}%`).map((row) => row.slug),
      [long],
    );
    assert.equal(
      db.prepare("SELECT storage_like(?,?) n").get("_x%", "😀xmore").n,
      1,
    );
    assert.equal(
      db.prepare("SELECT storage_like(?,?) n").get("a\\%b%", "a%bmore").n,
      1,
    );
    for (const [prefix, value] of [
      ["literal*?[", "literal*?[rest"],
      ["under\\_", "under_rest"],
      ["slash\\\\", "slash\\rest"],
    ]) {
      assert.equal(
        db.prepare("SELECT storage_like(?,?) n").get(`${prefix}%`, value).n,
        1,
      );
    }
    assert.equal(
      db.prepare("SELECT storage_like('anything%',NULL) n").get().n,
      null,
    );
    assert.throws(() => query.all("bad\0%"));
  } finally {
    db.close();
  }
});
