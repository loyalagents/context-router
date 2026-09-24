// Test-only process faults around the real compiled state service and worker. No fault channel ships in dist.
const path = require("node:path");
const fs = require("node:fs");
const { Worker } = require("node:worker_threads");
const [dist, databaseRoot, identityRoot, action, boundary = "none"] =
  process.argv.slice(2);
const from = (file) => require(path.join(dist, file));
const { SqliteDatabase } = from(
  "infrastructure/storage/sqlite/sqlite-database.js",
);
const { SqliteLocalIdentityCoordination } = from(
  "infrastructure/storage/sqlite/sqlite-local-identity-coordination.js",
);
const { LocalIdentityFileStore, nodeLocalIdentityFileSystem: native } = from(
  "modules/auth/local-identity-filesystem.js",
);
const { LocalIdentityStateService } = from(
  "modules/auth/local-identity-state.service.js",
);
let phase,
  fired = false,
  resume,
  outcome;
const paused = async (label) => {
  if (fired || boundary !== label) return;
  fired = true;
  process.send({ kind: "paused", boundary: label });
  await new Promise((resolve) => {
    resume = resolve;
  });
};
process.on("message", (message) => {
  if (message === "continue") resume?.();
});
// An IPC disconnect is not evidence that another owner may recover. End this original process and its threads.
process.on("disconnect", () => {
  if (outcome === undefined) process.exit(2);
});
const stageKind = (file) =>
  path.basename(file).startsWith("identity.stage-operation-")
    ? "operation"
    : /^identity\.stage-.*-candidate\.tmp$/.test(path.basename(file))
      ? "candidate"
      : null;
const dirVerify = () =>
  ({
    operationLinked: "operation.publish.postlink-verify",
    candidateLinked: "candidate.publish.postlink-verify",
    initialLinked: "initial.postlink-verify",
  })[phase];
const dirSync = () =>
  ({
    operationLinked: "operation.publish.dir-fsync",
    operationUnlinked: "operation.stage.dir-fsync",
    candidateLinked: "candidate.publish.dir-fsync",
    candidateUnlinked: "candidate.stage.dir-fsync",
    initialLinked: "initial.dir-fsync",
    initialUnlinked: "initial.cleanup-dir-fsync",
    rotated: "rotation.dir-fsync",
    operationCleanup: "operation-cleanup.dir-fsync",
    recoveryStage: "recovery-stage.cleanup-dir-fsync",
  })[phase];
const filesystem = {
  ...native,
  async open(file, flags, mode) {
    const root =
      file === identityRoot && (flags & fs.constants.O_DIRECTORY) !== 0;
    if (root) await paused(dirVerify());
    const kind = stageKind(file);
    if (kind && (flags & fs.constants.O_CREAT) !== 0)
      await paused(`${kind}.stage.before-create`);
    const handle = await native.open(file, flags, mode);
    if (kind && (flags & fs.constants.O_CREAT) !== 0)
      await paused(`${kind}.stage.create`);
    return {
      ...handle,
      async writeFile(bytes) {
        if (kind && boundary === `${kind}.stage.partial-write`) {
          await handle.writeFile(bytes.subarray(0, 1));
          await paused(`${kind}.stage.partial-write`);
        } else await handle.writeFile(bytes);
        if (kind) await paused(`${kind}.stage.write`);
      },
      async sync() {
        await handle.sync();
        if (kind) await paused(`${kind}.stage.file-fsync`);
        if (root) await paused(dirSync());
      },
    };
  },
  async link(source, target) {
    await native.link(source, target);
    const name = path.basename(target);
    if (name === "identity.operation.json") {
      phase = "operationLinked";
      await paused("operation.publish.link");
    } else if (/^identity\.(pending|rotate)-/.test(name)) {
      phase = "candidateLinked";
      await paused("candidate.publish.link");
    } else if (name === "identity.json") {
      phase = "initialLinked";
      await paused("initial.link");
    }
  },
  async unlink(file) {
    await native.unlink(file);
    const name = path.basename(file);
    if (name.startsWith("identity.stage-operation-")) {
      phase = boundary.startsWith("recovery-stage.")
        ? "recoveryStage"
        : "operationUnlinked";
      await paused("operation.stage.unlink");
      await paused("recovery-stage.unlink");
    } else if (stageKind(file) === "candidate") {
      phase = "candidateUnlinked";
      await paused("candidate.stage.unlink");
    } else if (/^identity\.(pending|rotate)-/.test(name)) {
      phase = "initialUnlinked";
      await paused("initial.candidate-unlink");
    } else if (name === "identity.operation.json") {
      phase = "operationCleanup";
      await paused("operation-cleanup.unlink");
    }
  },
  async rename(source, target) {
    await native.rename(source, target);
    phase = "rotated";
    await paused("rotation.rename");
  },
};
(async () => {
  if (action === "bootstrap" || action === "bootstrapInitialize") {
    const { DatabaseSync } = require("node:sqlite");
    const freeze = (label) => {
      if (boundary !== label) return;
      process.send({ kind: "paused", boundary: label });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    if (boundary === "bootstrap.race") {
      const readDirectory = fs.readdirSync;
      let reads = 0;
      const stop = (label, entries) => {
        process.send({
          kind: "paused",
          boundary: label,
          ...(entries === undefined ? {} : { entries }),
        });
        process.kill(process.pid, "SIGSTOP");
      };
      fs.readdirSync = function (file, ...args) {
        if (file !== databaseRoot)
          return readDirectory.call(this, file, ...args);
        reads++;
        if (reads === 2) stop("bootstrap.closed-stage");
        const names = readDirectory.call(this, file, ...args);
        if (reads === 1) stop("bootstrap.empty-observed", names.length);
        if (reads === 2) stop("bootstrap.entries-observed", names.length);
        return names;
      };
    }
    const exec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function (sql) {
      if (sql === "COMMIT") freeze("bootstrap.before-commit");
      const result = exec.call(this, sql);
      if (sql === "COMMIT") freeze("bootstrap.after-commit");
      return result;
    };
    const link = fs.linkSync,
      unlink = fs.unlinkSync;
    fs.linkSync = (...args) => {
      freeze("bootstrap.before-link");
      const result = link(...args);
      freeze("bootstrap.after-link");
      return result;
    };
    fs.unlinkSync = (...args) => {
      const result = unlink(...args);
      freeze("bootstrap.after-unlink");
      return result;
    };
    SqliteDatabase.bootstrap({ databaseRoot, identityRoot });
    if (action === "bootstrapInitialize") {
      process.env.LOCAL_DATABASE_ROOT = databaseRoot;
      process.env.LOCAL_IDENTITY_STATE_ROOT = identityRoot;
      const { runLocalDatabaseAdminCli } = from(
        "modules/auth/local-identity-admin.cli.js",
      );
      let output = "",
        failure = "";
      const code = await runLocalDatabaseAdminCli({
        argv: ["initialize"],
        writeStdout: (value) => {
          output += value;
        },
        writeStderr: (value) => {
          failure += value;
        },
      });
      if (
        code !== 0 ||
        failure ||
        output !==
          '{"type":"context-router.local-identity.admin","version":1,"operation":"initialize","status":"ok","generation":1}\n'
      )
        throw new Error("Owned initialize failed");
      const database = SqliteDatabase.open({ databaseRoot, identityRoot });
      const connection = database.connect();
      try {
        const principal = connection.get("SELECT user_id FROM users").user_id;
        connection.run("UPDATE users SET email=? WHERE user_id=?", [
          "preserved@local.invalid",
          principal,
        ]);
        connection.run(
          "INSERT INTO locations VALUES(?,?,'HOME',?,'preserved address',1,1)",
          ["bootstrap-sentinel", principal, "preserved label"],
        );
      } finally {
        connection.close();
      }
    }
    outcome = 0;
    process.exitCode = 0;
    process.send({ kind: "done" }, () => process.disconnect());
    return;
  }
  if (action === "recoverBootstrap") {
    const status = SqliteDatabase.recoverBootstrap({
      databaseRoot,
      identityRoot,
    });
    outcome = 0;
    process.exitCode = 0;
    process.send({ kind: "done", status }, () => process.disconnect());
    return;
  }
  const database = SqliteDatabase.open({ databaseRoot, identityRoot });
  if (action === "hotWrite") {
    const connection = database.connect();
    connection.exec("PRAGMA cache_size=4");
    connection.exec("BEGIN IMMEDIATE");
    for (let i = 0; i < 200; i++)
      connection.run("INSERT INTO users VALUES(?,?,?,?)", [
        `uncommitted-${i}`,
        "x".repeat(10000),
        1,
        1,
      ]);
    await paused("database.hot-write");
    connection.exec("ROLLBACK");
    connection.close();
    outcome = 0;
    process.exitCode = 0;
    process.send({ kind: "done" }, () => process.disconnect());
    return;
  }
  const repository = new SqliteLocalIdentityCoordination({
    database,
    deadlineMs: 500,
    workerFactory: (file, options) => {
      const worker = new Worker(file, options);
      const post = worker.postMessage.bind(worker),
        commands = new Map();
      worker.postMessage = (message, transfer) => {
        commands.set(message.id, message.command);
        if (
          boundary === "database.before-commit" &&
          message.command === "commit"
        ) {
          void paused("database.before-commit").then(() =>
            post(message, transfer),
          );
          return;
        }
        return post(message, transfer);
      };
      const emit = worker.emit.bind(worker);
      worker.emit = (event, ...args) => {
        if (
          event === "message" &&
          commands.get(args[0]?.id) === "commit" &&
          boundary === "database.after-commit-before-ack" &&
          !fired
        ) {
          void paused("database.after-commit-before-ack").then(() =>
            emit(event, ...args),
          );
          return true;
        }
        return emit(event, ...args);
      };
      return worker;
    },
  });
  const service = new LocalIdentityStateService({
    fileStore: new LocalIdentityFileStore({
      stateRoot: identityRoot,
      databaseTargetId: database.targetId,
      fileSystem: filesystem,
    }),
    repository,
  });
  const ready = await service[action]();
  outcome = 0;
  process.exitCode = 0;
  process.send(
    {
      kind: "done",
      generation: ready?.state.generation ?? null,
      principalId: ready?.state.principalId ?? null,
      targetId: database.targetId,
      digest: ready?.digest ?? null,
    },
    () => process.disconnect(),
  );
})().catch((error) => {
  outcome = 1;
  process.exitCode = 1;
  process.send({ kind: "failed", message: error.message }, () =>
    process.disconnect(),
  );
});
