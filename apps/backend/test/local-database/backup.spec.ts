import fs = require("node:fs");
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Worker, type WorkerOptions } from "node:worker_threads";
import {
  SqliteLocalIdentitySession,
  SqliteLocalIdentityCoordination,
} from "@/infrastructure/storage/sqlite/sqlite-local-identity-coordination";
import { SqliteBackup } from "@/infrastructure/storage/sqlite/sqlite-backup";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { SQLITE_TABLES } from "@/infrastructure/storage/sqlite/sqlite-schema";
import { fixtureRows } from "./fixture-rows";
import { decodeLocalIdentityState } from "@/modules/auth/local-identity-state.codec";
import { LocalIdentityFileStore } from "@/modules/auth/local-identity-filesystem";
import { LocalIdentityStrategy } from "@/modules/auth/strategies/local-identity.strategy";
import { UserService } from "@/modules/user/user.service";
import { SqliteUserRepository } from "@/infrastructure/storage/sqlite/sqlite-user.repository";

describe("same-held-connection matching-pair backup and new-root restore", () => {
  let root: string, db: SqliteDatabase, backup: SqliteBackup, bundle: string;
  const workers: Worker[] = [],
    messages: unknown[] = [];
  function factory(_file: string, options: WorkerOptions) {
    const worker = new Worker(
      path.resolve(
        __dirname,
        "../../dist/infrastructure/storage/sqlite/sqlite-coordination.worker.js",
      ),
      options,
    );
    workers.push(worker);
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (...args) => {
      messages.push(args[0]);
      return post(...args);
    };
    worker.on("message", (message) => messages.push(message));
    return worker;
  }
  function admin(database: SqliteDatabase, command: string) {
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../../dist/local-identity.js"), command],
      {
        env: {
          LOCAL_DATABASE_ROOT: database.paths.databaseRoot,
          LOCAL_IDENTITY_STATE_ROOT: database.paths.identityRoot,
        },
        encoding: "utf8",
        timeout: 8000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  }
  const bytes = (database: SqliteDatabase) =>
    fs.readFileSync(path.join(database.paths.identityRoot, "identity.json"));
  const state = (database: SqliteDatabase) =>
    decodeLocalIdentityState(bytes(database));
  const snapshot = (database: SqliteDatabase) => {
    const c = database.connect();
    try {
      return SQLITE_TABLES.map((table) =>
        c.all(`SELECT * FROM ${table} ORDER BY 1`).map((row) => ({ ...row })),
      );
    } finally {
      c.close();
    }
  };
  async function authenticate(database: SqliteDatabase, credential: string) {
    const strategy = new LocalIdentityStrategy(
      new LocalIdentityFileStore({
        stateRoot: database.paths.identityRoot,
        databaseTargetId: database.targetId,
      }),
      new UserService(new SqliteUserRepository(database)),
    );
    return strategy.validate({
      headers: { authorization: `Bearer ${credential}` },
      rawHeaders: ["Authorization", `Bearer ${credential}`],
    } as any);
  }
  beforeEach(async () => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-backup-")),
    );
    bundle = path.join(root, "bundle");
    const paths = {
      databaseRoot: path.join(root, "source"),
      identityRoot: path.join(root, "identity"),
    };
    const initialized = spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../../dist/local-identity.js"), "initialize"],
      {
        env: {
          LOCAL_DATABASE_ROOT: paths.databaseRoot,
          LOCAL_IDENTITY_STATE_ROOT: paths.identityRoot,
        },
        encoding: "utf8",
        timeout: 8000,
      },
    );
    expect(initialized.status).toBe(0);
    expect(initialized.stderr).toBe("");
    db = SqliteDatabase.open(paths);
    backup = new SqliteBackup({ workerFactory: factory });
    messages.length = 0;
    const rows = fixtureRows(db),
      userId = state(db).principalId;
    await rows.user.update({
      where: { userId },
      data: { email: "changed@example.test" },
    });
    await rows.externalIdentity.create({
      data: {
        userId,
        provider: "test",
        issuer: "private-issuer",
        providerUserId: "private-subject",
        metadata: { private: "metadata-canary" },
      },
    });
    const loc = await rows.location.create({
      data: { userId, type: "HOME", label: "Home", address: "private-address" },
    });
    const def = await rows.preferenceDefinition.findFirst({
      where: { slug: "profile.first_name" },
    });
    await rows.preference.create({
      data: {
        userId,
        definitionId: def.id,
        contextKey: loc.locationId,
        locationId: loc.locationId,
        value: { private: "value-canary" },
      },
    });
    await rows.preferenceAuditEvent.create({
      data: {
        userId,
        subjectSlug: def.slug,
        targetType: "PREFERENCE",
        targetId: "retained-target",
        eventType: "PREFERENCE_SET",
        actorType: "USER",
        origin: "GRAPHQL",
        correlationId: "test",
        metadata: { private: "audit-canary" },
      },
    });
    await rows.mcpAccessEvent.create({
      data: {
        userId,
        clientKey: "codex",
        surface: "TOOLS_CALL",
        operationName: "test",
        outcome: "SUCCESS",
        correlationId: "test",
        latencyMs: 1,
      },
    });
    await rows.permissionGrant.create({
      data: {
        userId,
        clientKey: "codex",
        target: "*",
        action: "WRITE",
        effect: "ALLOW",
      },
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    const results = await Promise.allSettled(
      workers.splice(0).map(async (worker) => {
        if (worker.threadId !== -1) await worker.terminate();
        expect(worker.threadId).toBe(-1);
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Worker exit uncertain; backup fixture preserved");
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("restores every table, exact identity bytes and old credential, then rotates the restored pair without changing source or bundle", async () => {
    const before = snapshot(db),
      identity = bytes(db),
      old = state(db);
    await backup.create(db, bundle);
    const bundleBytes = fs.readFileSync(
      path.join(bundle, "data/database.sqlite"),
    );
    admin(db, "rotate");
    const sourceIdentity = bytes(db),
      current = state(db);
    const restored = await backup.restore(bundle, path.join(root, "restored"));
    expect(snapshot(restored)).toEqual(before);
    expect(bytes(restored)).toEqual(identity);
    expect(restored.targetId).toBe(db.targetId);
    expect(await authenticate(restored, old.credential)).toMatchObject({
      userId: old.principalId,
    });
    expect(await authenticate(restored, current.credential)).toBe(false);
    admin(restored, "rotate");
    const rotated = state(restored);
    expect(rotated.principalId).toBe(old.principalId);
    expect(await authenticate(restored, old.credential)).toBe(false);
    expect(await authenticate(restored, rotated.credential)).toMatchObject({
      userId: old.principalId,
    });
    expect(snapshot(restored)).toEqual(before);
    expect(snapshot(db)).toEqual(before);
    expect(bytes(db)).toEqual(sourceIdentity);
    expect(fs.readFileSync(path.join(bundle, "data/database.sqlite"))).toEqual(
      bundleBytes,
    );
    expect(
      fs.readFileSync(path.join(bundle, "identity/identity.json")),
    ).toEqual(identity);
    const wire = JSON.stringify(messages);
    for (const secret of [
      old.credential,
      current.credential,
      "metadata-canary",
      "private-issuer",
      "private-subject",
      "changed@example.test",
      "value-canary",
    ])
      expect(wire).not.toContain(secret);
  });
  it("retains independent reader/writer and real rotation exclusion through verification, backup ACK, identity copy and completed-marker fsync", async () => {
    const originalIdentity = bytes(db),
      reached: string[] = [];
    function excluded(point: string) {
      for (const sql of ["SELECT count(*) FROM users", "BEGIN IMMEDIATE"]) {
        const result = spawnSync(
          process.execPath,
          [
            "-e",
            `const {DatabaseSync}=require('node:sqlite');let d;try{d=new DatabaseSync(process.argv[1],{timeout:0});d.exec(process.argv[2]);process.exitCode=3}catch(e){process.exitCode=(e.errcode&255)===5?0:4}finally{d?.close()}`,
            path.join(db.paths.databaseRoot, "database.sqlite"),
            sql,
          ],
          { env: {}, encoding: "utf8", timeout: 4000 },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      }
      const result = spawnSync(
        process.execPath,
        [path.resolve(__dirname, "../../dist/local-identity.js"), "rotate"],
        {
          env: {
            LOCAL_DATABASE_ROOT: db.paths.databaseRoot,
            LOCAL_IDENTITY_STATE_ROOT: db.paths.identityRoot,
          },
          encoding: "utf8",
          timeout: 4000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Local identity command failed\n");
      expect(bytes(db)).toEqual(originalIdentity);
      expect(fs.readdirSync(db.paths.identityRoot)).toEqual(["identity.json"]);
      reached.push(point);
    }
    const verify = SqliteLocalIdentitySession.prototype.verify,
      copy = SqliteLocalIdentitySession.prototype.backupTo;
    jest
      .spyOn(SqliteLocalIdentitySession.prototype, "verify")
      .mockImplementation(async function (...args) {
        await verify.apply(this, args);
        excluded("verified-commit");
      });
    jest
      .spyOn(SqliteLocalIdentitySession.prototype, "backupTo")
      .mockImplementation(async function (...args) {
        await copy.apply(this, args);
        excluded("backup-ack");
      });
    const write = fs.writeFileSync;
    jest.spyOn(fs, "writeFileSync").mockImplementation(((
      file,
      value,
      ...args
    ) => {
      const result = write(file, value, ...args);
      if (Buffer.isBuffer(value) && value.equals(originalIdentity))
        excluded("identity-copy");
      return result;
    }) as typeof write);
    const sync = fs.fsyncSync;
    let markerChecked = false;
    jest.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      sync(fd);
      if (
        !markerChecked &&
        fs.existsSync(path.join(bundle, "complete.json")) &&
        fs.fstatSync(fd).ino === fs.lstatSync(bundle).ino
      ) {
        markerChecked = true;
        excluded("marker-fsync");
      }
    });
    await backup.create(db, bundle);
    expect(reached).toEqual([
      "verified-commit",
      "backup-ack",
      "identity-copy",
      "marker-fsync",
    ]);
    jest.restoreAllMocks();
    const c = db.connect();
    c.exec("BEGIN IMMEDIATE");
    c.exec("ROLLBACK");
    c.close();
  });
  it("preserves incomplete backup after lost acknowledgement, fences the original process, and waits for actual worker death before inspecting destination", async () => {
    let dropped = false;
    const lossy = new SqliteBackup({
      deadlineMs: 250,
      workerFactory: (file, options) => {
        const worker = factory(file, options),
          post = worker.postMessage.bind(worker),
          emit = worker.emit.bind(worker);
        let backupId = -1;
        worker.postMessage = (...args) => {
          if (args[0].command === "backup") backupId = args[0].id;
          return post(...args);
        };
        worker.emit = ((event: string, ...args: any[]) => {
          if (event === "message" && args[0]?.id === backupId && args[0]?.ok) {
            dropped = true;
            return true;
          }
          return emit(event, ...args);
        }) as typeof worker.emit;
        return worker;
      },
    });
    await expect(lossy.create(db, bundle)).rejects.toThrow(
      "Local database backup failed",
    );
    expect(dropped).toBe(true);
    expect(fs.existsSync(path.join(bundle, "complete.json"))).toBe(false);
    await Promise.all(
      workers.map((worker) =>
        worker.threadId === -1 ? undefined : worker.terminate(),
      ),
    );
    await expect(
      new SqliteLocalIdentityCoordination({
        database: db,
        workerFactory: factory,
      }).acquire(),
    ).rejects.toThrow("recovery required");
    const copied = SqliteDatabase.open({
        databaseRoot: path.join(bundle, "data"),
        identityRoot: path.join(bundle, "identity"),
        expectedTarget: db.targetId,
      }),
      c = copied.connect();
    c.exec("BEGIN EXCLUSIVE");
    c.exec("ROLLBACK");
    c.close();
    expect(snapshot(copied)).toEqual(snapshot(db));
    await expect(
      backup.restore(bundle, path.join(root, "incomplete")),
    ).rejects.toThrow("Local database restore failed");
    expect(fs.existsSync(path.join(root, "incomplete"))).toBe(false);
  });
  it("terminates a genuinely pending multistep backup without publishing and releases native handles only at actual worker exit", async () => {
    const rows = fixtureRows(db),
      preference = await rows.preference.findFirst();
    await rows.preference.update({
      where: { id: preference.id },
      data: { value: "large".repeat(250000) },
    });
    let pending = false,
      owner: Worker;
    const active = new SqliteBackup({
      deadlineMs: 500,
      workerFactory: (_file, options) => {
        const entry = path.resolve(
          __dirname,
          "../../dist/infrastructure/storage/sqlite/sqlite-coordination.worker.js",
        );
        owner = new Worker(
          `const {parentPort}=require('node:worker_threads');const sqlite=require('node:sqlite');const backup=sqlite.backup;sqlite.backup=(db,destination)=>backup(db,destination,{rate:1,progress(info){if(info.remainingPages>0){parentPort.postMessage({fixturePending:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}}});require(${JSON.stringify(entry)});`,
          { ...options, eval: true },
        );
        workers.push(owner);
        const emit = owner.emit.bind(owner);
        owner.emit = ((event: string, ...args: any[]) => {
          if (event === "message" && args[0]?.fixturePending === true) {
            pending = true;
            return true;
          }
          return emit(event, ...args);
        }) as typeof owner.emit;
        return owner;
      },
    });
    await expect(active.create(db, bundle)).rejects.toThrow(
      "Local database backup failed",
    );
    expect(pending).toBe(true);
    expect(fs.existsSync(path.join(bundle, "complete.json"))).toBe(false);
    if (owner!.threadId !== -1) await owner!.terminate();
    expect(owner!.threadId).toBe(-1);
    const c = db.connect();
    c.exec("BEGIN EXCLUSIVE");
    c.exec("ROLLBACK");
    c.close();
    const destination = path.join(bundle, "data/database.sqlite"),
      native = new DatabaseSync(destination);
    try {
      native.exec("BEGIN EXCLUSIVE");
      native.exec("ROLLBACK");
    } finally {
      native.close();
    }
    const final = fs.readFileSync(destination);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fs.readFileSync(destination)).toEqual(final);
    await expect(
      new SqliteLocalIdentityCoordination({
        database: db,
        workerFactory: factory,
      }).acquire(),
    ).rejects.toThrow("recovery required");
  });
  it("does not close a native backup source on an overlapping protocol command and publishes no completion", async () => {
    const rows = fixtureRows(db),
      preference = await rows.preference.findFirst();
    await rows.preference.update({
      where: { id: preference.id },
      data: { value: "large".repeat(250000) },
    });
    const unsafeCloseCounter = new SharedArrayBuffer(4);
    let injected = false,
      pendingObserved = false,
      owner: Worker;
    const overlapping = new SqliteBackup({
      deadlineMs: 1000,
      workerFactory: (_file, options) => {
        const entry = path.resolve(
          __dirname,
          "../../dist/infrastructure/storage/sqlite/sqlite-coordination.worker.js",
        );
        owner = new Worker(
          `const {parentPort,workerData}=require('node:worker_threads');const unsafeCounter=new Int32Array(workerData.unsafeCloseCounter);const sqlite=require('node:sqlite');const backup=sqlite.backup,close=sqlite.DatabaseSync.prototype.close;let active=false;sqlite.backup=async(db,destination)=>{active=true;parentPort.postMessage({fixtureStarted:true});try{await backup(db,destination,{rate:1});await new Promise(r=>setTimeout(r,40));}finally{active=false}};sqlite.DatabaseSync.prototype.close=function(){if(active){Atomics.add(unsafeCounter,0,1);throw new Error('unsafe')}return close.call(this)};require(${JSON.stringify(entry)});`,
          {
            ...options,
            workerData: { ...options.workerData, unsafeCloseCounter },
            eval: true,
          },
        );
        workers.push(owner);
        const emit = owner.emit.bind(owner),
          post = owner.postMessage.bind(owner);
        let nextId = 0;
        owner.postMessage = (...args) => {
          nextId = args[0].id;
          return post(...args);
        };
        owner.emit = ((event: string, ...args: any[]) => {
          if (event === "message" && args[0]?.fixtureStarted) {
            pendingObserved = true;
            injected = true;
            post({ id: nextId + 1, command: "close" });
            return true;
          }
          return emit(event, ...args);
        }) as typeof owner.emit;
        return owner;
      },
    });
    await expect(overlapping.create(db, bundle)).rejects.toThrow(
      "Local database backup failed",
    );
    expect(injected && pendingObserved).toBe(true);
    expect(fs.existsSync(path.join(bundle, "complete.json"))).toBe(false);
    if (owner!.threadId !== -1) await owner!.terminate();
    expect(owner!.threadId).toBe(-1);
    expect(Atomics.load(new Int32Array(unsafeCloseCounter), 0)).toBe(0);
    const c = db.connect();
    c.exec("BEGIN EXCLUSIVE");
    c.exec("ROLLBACK");
    c.close();
  });
  it("leaves a verified database copy unready when interrupted before canonical identity publication", async () => {
    await backup.create(db, bundle);
    const verify = SqliteLocalIdentitySession.prototype.verify;
    jest
      .spyOn(SqliteLocalIdentitySession.prototype, "verify")
      .mockImplementation(async function (...args) {
        await verify.apply(this, args);
        throw new Error("fixture interruption before identity publication");
      });
    const destination = path.join(root, "unpublished");
    await expect(backup.restore(bundle, destination)).rejects.toThrow(
      "Local database restore failed",
    );
    jest.restoreAllMocks();
    expect(fs.readdirSync(path.join(destination, "identity"))).toEqual([]);
    const restored = SqliteDatabase.open({
      databaseRoot: path.join(destination, "data"),
      identityRoot: path.join(destination, "identity"),
    });
    expect(snapshot(restored)).toEqual(snapshot(db));
    const preview = spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../../dist/local-identity.js"), "preview"],
      {
        env: {
          LOCAL_DATABASE_ROOT: restored.paths.databaseRoot,
          LOCAL_IDENTITY_STATE_ROOT: restored.paths.identityRoot,
        },
        encoding: "utf8",
        timeout: 4000,
      },
    );
    expect(preview.error).toBeUndefined();
    expect(preview.status).toBe(1);
    expect(preview.stdout).toBe("");
    expect(preview.stderr).toBe("Local identity command failed\n");
  });
  it.each(["extra", "symlink", "hardlink", "mode", "missing-marker"])(
    "rejects an unsafe %s bundle before creating restore state",
    async (kind) => {
      await backup.create(db, bundle);
      const databaseFile = path.join(bundle, "data/database.sqlite");
      if (kind === "extra")
        fs.writeFileSync(path.join(bundle, "unknown"), "preserve", {
          mode: 0o600,
        });
      if (kind === "symlink") {
        const outside = path.join(root, "closed-outside.sqlite");
        fs.renameSync(databaseFile, outside);
        fs.symlinkSync(outside, databaseFile);
      }
      if (kind === "hardlink")
        fs.linkSync(databaseFile, path.join(root, "linked.sqlite"));
      if (kind === "mode") fs.chmodSync(databaseFile, 0o644);
      if (kind === "missing-marker")
        fs.unlinkSync(path.join(bundle, "complete.json"));
      const entries = fs.readdirSync(bundle),
        before = fs.lstatSync(databaseFile);
      const destination = path.join(root, "unsafe");
      await expect(backup.restore(bundle, destination)).rejects.toThrow(
        "Local database restore failed",
      );
      expect(fs.existsSync(destination)).toBe(false);
      expect(fs.readdirSync(bundle)).toEqual(entries);
      expect(fs.lstatSync(databaseFile)).toMatchObject({
        ino: before.ino,
        nlink: before.nlink,
        mode: before.mode,
        size: before.size,
      });
    },
  );
  it("attempts both owned descriptor closes after a destination close error and preserves incomplete restore", async () => {
    await backup.create(db, bundle);
    const sourceFile = path.join(bundle, "data/database.sqlite"),
      destination = path.join(root, "close-failed");
    const open = fs.openSync,
      close = fs.closeSync;
    let input = -1,
      output = -1,
      failed = false,
      failedAt = -1;
    const closes: number[] = [];
    jest.spyOn(fs, "openSync").mockImplementation(((file, ...args) => {
      const fd = open(file, ...args);
      if (file === sourceFile) input = fd;
      if (file === path.join(destination, "data/database.sqlite")) output = fd;
      return fd;
    }) as typeof open);
    jest.spyOn(fs, "closeSync").mockImplementation((fd) => {
      closes.push(fd);
      close(fd);
      if (fd === output && !failed) {
        failed = true;
        failedAt = closes.length - 1;
        throw new Error("fixture close uncertainty");
      }
    });
    await expect(backup.restore(bundle, destination)).rejects.toThrow(
      "Local database restore failed",
    );
    expect(failed).toBe(true);
    expect(closes.slice(failedAt + 1)).toContain(input);
    expect(fs.existsSync(path.join(destination, "data/database.sqlite"))).toBe(
      true,
    );
  });
  it("preserves a complete bundle after publication acknowledgement failure and restores only its final verified envelope", async () => {
    const unlink = fs.unlinkSync;
    jest.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      const result = unlink(file);
      if (file === path.join(bundle, "complete.stage"))
        throw new Error("private-publication-canary");
      return result;
    });
    await expect(backup.create(db, bundle)).rejects.toThrow(
      "Local database backup failed",
    );
    jest.restoreAllMocks();
    expect(fs.existsSync(path.join(bundle, "complete.json"))).toBe(true);
    const restored = await backup.restore(
      bundle,
      path.join(root, "ack-ambiguous"),
    );
    expect(snapshot(restored)).toEqual(snapshot(db));
    expect(bytes(restored)).toEqual(bytes(db));
  });
  it("creates only private bundle and restore files under a permissive umask", async () => {
    const previous = process.umask(0);
    try {
      await backup.create(db, bundle);
      const destination = path.join(root, "private-copy");
      await backup.restore(bundle, destination);
      const inspect = (file: string) => {
        const value = fs.lstatSync(file);
        expect(value.mode & 0o7777).toBe(value.isDirectory() ? 0o700 : 0o600);
        if (value.isDirectory())
          for (const name of fs.readdirSync(file))
            inspect(path.join(file, name));
      };
      inspect(bundle);
      inspect(destination);
    } finally {
      process.umask(previous);
    }
  });
  it("refuses every preexisting destination and incomplete envelope without overwriting", async () => {
    fs.mkdirSync(bundle, { mode: 0o700 });
    fs.writeFileSync(path.join(bundle, "keep"), "private-existing", {
      mode: 0o600,
    });
    await expect(backup.create(db, bundle)).rejects.toThrow(
      "Local database backup failed",
    );
    expect(fs.readFileSync(path.join(bundle, "keep"), "utf8")).toBe(
      "private-existing",
    );
    await expect(
      backup.restore(bundle, path.join(root, "restore-missing")),
    ).rejects.toThrow("Local database restore failed");
    expect(fs.existsSync(path.join(root, "restore-missing"))).toBe(false);
    const complete = path.join(root, "complete");
    await backup.create(db, complete);
    const destination = path.join(root, "existing");
    fs.mkdirSync(destination, { mode: 0o700 });
    await expect(backup.restore(complete, destination)).rejects.toThrow(
      "Local database restore failed",
    );
    expect(fs.readdirSync(destination)).toEqual([]);
  });
  it("refuses identity residue and foreign principal without publishing a bundle", async () => {
    const residue = path.join(db.paths.identityRoot, "unknown");
    fs.writeFileSync(residue, "private-residue", { mode: 0o600 });
    await expect(backup.create(db, bundle)).rejects.toThrow(
      "Local database backup failed",
    );
    expect(fs.existsSync(bundle)).toBe(false);
    fs.unlinkSync(residue);
    const rows = fixtureRows(db);
    await rows.user.create({
      data: { userId: "foreign", email: "foreign@example.test" },
    });
    const before = snapshot(db),
      identity = bytes(db);
    await expect(backup.create(db, bundle)).rejects.toThrow(
      "Local database backup failed",
    );
    expect(fs.existsSync(bundle)).toBe(false);
    expect(snapshot(db)).toEqual(before);
    expect(bytes(db)).toEqual(identity);
  });
  it.each(["target", "principal", "schema", "integrity", "foreign-key"])(
    "reaches copied-database %s rejection with a rebound envelope, preserving every bundle byte",
    async (kind) => {
      await backup.create(db, bundle);
      const databaseFile = path.join(bundle, "data/database.sqlite"),
        identityFile = path.join(bundle, "identity/identity.json"),
        markerFile = path.join(bundle, "complete.json");
      const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
      if (kind === "target" || kind === "principal") {
        const changed = JSON.parse(fs.readFileSync(identityFile, "utf8"));
        changed[kind === "target" ? "databaseTargetId" : "principalId"] =
          Buffer.alloc(32, 23).toString("base64url");
        fs.writeFileSync(identityFile, JSON.stringify(changed) + "\n");
        marker.databaseTargetId = changed.databaseTargetId;
        marker.principalId = changed.principalId;
      } else {
        const native = new DatabaseSync(databaseFile, {
          enableForeignKeyConstraints: false,
        });
        try {
          if (kind === "schema")
            native.exec("CREATE TABLE foreign_table(id INTEGER)");
          if (kind === "foreign-key")
            native
              .prepare("UPDATE external_identities SET user_id=?")
              .run("orphan");
          if (kind === "integrity") {
            (
              native as DatabaseSync & { enableDefensive(value: boolean): void }
            ).enableDefensive(false);
            native.exec(
              "PRAGMA writable_schema=ON; UPDATE sqlite_schema SET rootpage=(SELECT rootpage FROM sqlite_schema WHERE name='locations') WHERE name='user_preferences'",
            );
          }
        } finally {
          native.close();
        }
      }
      marker.identityDigest = createHash("sha256")
        .update(fs.readFileSync(identityFile))
        .digest("hex");
      marker.databaseDigest = createHash("sha256")
        .update(fs.readFileSync(databaseFile))
        .digest("hex");
      fs.writeFileSync(markerFile, JSON.stringify(marker) + "\n");
      const original = [databaseFile, identityFile, markerFile].map((file) =>
        fs.readFileSync(file),
      );
      const copiedRoot = path.join(root, "invalid-copy");
      const opens = jest.spyOn(SqliteDatabase, "open");
      await expect(backup.restore(bundle, copiedRoot)).rejects.toThrow(
        "Local database restore failed",
      );
      expect(fs.readdirSync(path.join(copiedRoot, "identity"))).toEqual([]);
      expect(opens).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseRoot: path.join(copiedRoot, "data"),
          expectedTarget: marker.databaseTargetId,
        }),
      );
      expect(
        [databaseFile, identityFile, markerFile].map((file) =>
          fs.readFileSync(file),
        ),
      ).toEqual(original);
    },
  );
  it("rejects a foreign copied identity and preserves original bundle bytes", async () => {
    await backup.create(db, bundle);
    const file = path.join(bundle, "identity/identity.json");
    const invalid = JSON.parse(fs.readFileSync(file, "utf8"));
    invalid.databaseTargetId = Buffer.alloc(32, 19).toString("base64url");
    fs.writeFileSync(file, JSON.stringify(invalid) + "\n");
    const original = fs.readFileSync(file);
    await expect(
      backup.restore(bundle, path.join(root, "foreign")),
    ).rejects.toThrow("Local database restore failed");
    expect(fs.readFileSync(file)).toEqual(original);
  });
});
