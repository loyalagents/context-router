import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import {
  decodeLocalIdentityState,
  encodeLocalIdentityState,
  encodeLocalIdentityOperation,
  createInitializeOperation,
  createRecoveryOperation,
  digestLocalIdentityState,
} from "@/modules/auth/local-identity-state.codec";
import { OwnedIdentityProcesses, waitForStopped } from "./process.fixture";

const token = () => randomBytes(32).toString("base64url");
const stages = (prefix: string) =>
  ["create", "partial-write", "write", "file-fsync"].map(
    (point) => `${prefix}.stage.${point}`,
  );
const publication = (prefix: string) =>
  ["link", "postlink-verify", "dir-fsync"].map(
    (point) => `${prefix}.publish.${point}`,
  );
const stageCleanup = (prefix: string) =>
  ["unlink", "dir-fsync"].map((point) => `${prefix}.stage.${point}`);
const preparation = [
  ...stages("operation"),
  ...publication("operation"),
  ...stageCleanup("operation"),
  ...stages("candidate"),
  ...publication("candidate"),
  ...stageCleanup("candidate"),
];
const initialCases = [
  ...preparation,
  "database.before-commit",
  "database.after-commit-before-ack",
  "initial.link",
  "initial.postlink-verify",
  "initial.dir-fsync",
  "initial.candidate-unlink",
  "initial.cleanup-dir-fsync",
  "operation-cleanup.unlink",
  "operation-cleanup.dir-fsync",
];
const rotationCases = [
  ...preparation,
  "rotation.rename",
  "rotation.dir-fsync",
  "operation-cleanup.unlink",
  "operation-cleanup.dir-fsync",
];

describe("real SQLite process and identity recovery", () => {
  let parent: string,
    database: SqliteDatabase,
    processes: OwnedIdentityProcesses;
  const identity = () => database.paths.identityRoot;
  const canonical = () => path.join(identity(), "identity.json");
  const read = () => decodeLocalIdentityState(fs.readFileSync(canonical()));
  const names = () => fs.readdirSync(identity()).sort();
  const artifacts = () =>
    names().map((name) => {
      const file = path.join(identity(), name),
        s = fs.lstatSync(file);
      return {
        name,
        bytes: fs.readFileSync(file),
        ino: s.ino,
        dev: s.dev,
        nlink: s.nlink,
        mode: s.mode,
      };
    });
  const rows = () => {
    const c = database.connect();
    try {
      return {
        users: c
          .all("SELECT * FROM users ORDER BY user_id")
          .map((row) => ({ ...row })),
        identities: c
          .all("SELECT * FROM external_identities ORDER BY id")
          .map((row) => ({ ...row })),
      };
    } finally {
      c.close();
    }
  };
  const command = (action: string) =>
    processes.command(database.paths.databaseRoot, identity(), action);
  beforeEach(() => {
    parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-recovery-test-")),
    );
    database = SqliteDatabase.bootstrap({
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    });
    processes = new OwnedIdentityProcesses();
  });
  afterEach(async () => {
    await processes.dispose();
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it.each(initialCases)(
    "recovers after terminating and reaping initialize at %s",
    async (boundary) => {
      const original = processes.start(
        database.paths.databaseRoot,
        identity(),
        "initialize",
        boundary,
      );
      expect(await original.next()).toEqual({ kind: "paused", boundary });
      const before = artifacts();
      const complete =
        before.find((item) => item.name.startsWith("identity.pending-")) ??
        before.find((item) => item.name === "identity.json");
      // Complete published candidate, canonical, and fixed operation fences are observed before death.
      expect(before.length).toBeGreaterThan(0);
      if (before.some((item) => item.nlink === 2)) {
        for (const linked of before.filter((item) => item.nlink === 2))
          expect(
            before.filter(
              (item) => item.ino === linked.ino && item.dev === linked.dev,
            ),
          ).toHaveLength(2);
      }
      await original.terminate();
      expect(original.child.signalCode).toBe("SIGKILL");
      const recovered = await command("recoverInitialize");
      expect(recovered.kind).toBe("done");
      if (recovered.generation === null)
        expect((await command("initialize")).kind).toBe("done");
      expect(names()).toEqual(["identity.json"]);
      if (complete)
        expect(fs.readFileSync(canonical())).toEqual(complete.bytes);
      const ready = read();
      expect(ready.databaseTargetId).toBe(database.targetId);
      expect(ready.generation).toBe(1);
      expect(rows().users.map((row) => row.user_id)).toEqual([
        ready.principalId,
      ]);
      expect((await command("verifyReadyState")).kind).toBe("done");
    },
  );
  it.each(rotationCases)(
    "retains the correct credential generation after terminating rotation at %s",
    async (boundary) => {
      expect((await command("initialize")).kind).toBe("done");
      const oldBytes = fs.readFileSync(canonical()),
        old = read(),
        beforeRows = rows();
      const original = processes.start(
        database.paths.databaseRoot,
        identity(),
        "rotate",
        boundary,
      );
      expect(await original.next()).toEqual({ kind: "paused", boundary });
      const published = fs.readFileSync(canonical());
      await original.terminate();
      expect((await command("recoverRotation")).kind).toBe("done");
      expect(names()).toEqual(["identity.json"]);
      const afterRename =
        boundary.startsWith("rotation.") ||
        boundary.startsWith("operation-cleanup.");
      expect(fs.readFileSync(canonical())).toEqual(
        afterRename ? published : oldBytes,
      );
      const ready = read();
      expect(ready.principalId).toBe(old.principalId);
      expect(ready.databaseTargetId).toBe(old.databaseTargetId);
      expect(ready.generation).toBe(afterRename ? 2 : 1);
      expect(ready.credential === old.credential).toBe(!afterRename);
      expect(rows()).toEqual(beforeRows);
    },
  );
  it("retains ownership in a stopped original process; recovery starts only after kill and actual reap", async () => {
    const original = processes.start(
      database.paths.databaseRoot,
      identity(),
      "initialize",
      "candidate.stage.dir-fsync",
    );
    expect((await original.next()).kind).toBe("paused");
    expect(original.child.kill("SIGSTOP")).toBe(true);
    await waitForStopped(original.child);
    const before = artifacts();
    expect((await command("recoverInitialize")).kind).toBe("failed");
    expect(artifacts()).toEqual(before);
    const otherIdentity = path.join(parent, "other-identity");
    expect(
      (
        await processes.command(
          database.paths.databaseRoot,
          otherIdentity,
          "initialize",
        )
      ).kind,
    ).toBe("failed");
    expect(fs.existsSync(otherIdentity)).toBe(false);
    await original.terminate();
    expect((await command("recoverInitialize")).kind).toBe("done");
    expect(fs.readFileSync(canonical())).toEqual(
      before.find((item) => item.name.startsWith("identity.pending-"))!.bytes,
    );
  });
  it.each([
    "database.before-commit",
    "database.after-commit-before-ack",
    "initial.link",
    "initial.candidate-unlink",
  ])(
    "excludes an independent different-root contender while paused at %s",
    async (boundary) => {
      const original = processes.start(
        database.paths.databaseRoot,
        identity(),
        "initialize",
        boundary,
      );
      expect((await original.next()).kind).toBe("paused");
      expect(original.child.kill("SIGSTOP")).toBe(true);
      await waitForStopped(original.child);
      const before = artifacts(),
        otherRoot = path.join(parent, "contender-identity");
      expect(
        (
          await processes.command(
            database.paths.databaseRoot,
            otherRoot,
            "initialize",
          )
        ).kind,
      ).toBe("failed");
      expect(fs.existsSync(otherRoot)).toBe(false);
      expect(artifacts()).toEqual(before);
      await original.terminate();
      expect((await command("recoverInitialize")).kind).toBe("done");
      const proposed =
        before.find((item) => item.name.startsWith("identity.pending-")) ??
        before.find((item) => item.name === "identity.json");
      expect(fs.readFileSync(canonical())).toEqual(proposed!.bytes);
    },
  );
  it("replays a real spilled hot journal through production admission after terminating its writer", async () => {
    expect((await command("initialize")).kind).toBe("done");
    const before = rows(),
      bytes = fs.readFileSync(canonical());
    const writer = processes.start(
      database.paths.databaseRoot,
      identity(),
      "hotWrite",
      "database.hot-write",
    );
    expect((await writer.next()).kind).toBe("paused");
    const journal = path.join(
      database.paths.databaseRoot,
      "database.sqlite-journal",
    );
    expect(fs.statSync(journal).size).toBeGreaterThan(100);
    await writer.terminate();
    expect(rows()).toEqual(before);
    expect(fs.readFileSync(canonical())).toEqual(bytes);
    expect(fs.existsSync(journal)).toBe(false);
    expect((await command("verifyReadyState")).kind).toBe("done");
  });
  it.each([
    "bootstrap.before-commit",
    "bootstrap.after-commit",
    "bootstrap.before-link",
    "bootstrap.after-link",
    "bootstrap.after-unlink",
  ])(
    "preserves production bootstrap state across process death at %s",
    async (boundary) => {
      const fresh = path.join(parent, "fresh-data"),
        freshIdentity = path.join(parent, "fresh-identity");
      const writer = processes.start(
        fresh,
        freshIdentity,
        "bootstrap",
        boundary,
      );
      expect(await writer.next()).toEqual({ kind: "paused", boundary });
      await writer.terminate();
      const before = fs
        .readdirSync(fresh)
        .sort()
        .map((name) => ({
          name,
          bytes: fs.readFileSync(path.join(fresh, name)),
          ino: fs.statSync(path.join(fresh, name)).ino,
          links: fs.statSync(path.join(fresh, name)).nlink,
        }));
      const recovery = await processes.command(
        fresh,
        freshIdentity,
        "recoverBootstrap",
      );
      if (boundary === "bootstrap.before-commit") {
        expect(recovery.kind).toBe("failed");
        expect(
          fs
            .readdirSync(fresh)
            .sort()
            .map((name) => ({
              name,
              bytes: fs.readFileSync(path.join(fresh, name)),
              ino: fs.statSync(path.join(fresh, name)).ino,
              links: fs.statSync(path.join(fresh, name)).nlink,
            })),
        ).toEqual(before);
      } else {
        expect(recovery).toEqual({
          kind: "done",
          status: boundary === "bootstrap.after-unlink" ? "none" : "recovered",
        });
        expect(fs.readdirSync(fresh)).toEqual(["database.sqlite"]);
        const reopened = SqliteDatabase.open({
          databaseRoot: fresh,
          identityRoot: freshIdentity,
        });
        const c = reopened.connect();
        try {
          expect(c.get("SELECT count(*) n FROM users").n).toBe(0);
          expect(c.get("PRAGMA integrity_check").integrity_check).toBe("ok");
        } finally {
          c.close();
        }
      }
      expect(fs.existsSync(freshIdentity)).toBe(false);
    },
  );
  it("has no orphan worker when the original parent loses its supervisor IPC", async () => {
    const original = processes.start(
      database.paths.databaseRoot,
      identity(),
      "initialize",
      "candidate.stage.dir-fsync",
    );
    expect((await original.next()).kind).toBe("paused");
    original.child.disconnect();
    await original.reap();
    expect(original.child.exitCode).toBe(2);
    expect((await command("recoverInitialize")).kind).toBe("done");
    expect(rows().users).toHaveLength(1);
  });
  it("preserves exact candidate and operation after a lost real COMMIT acknowledgement and recovers the same principal", async () => {
    const original = processes.start(
      database.paths.databaseRoot,
      identity(),
      "initialize",
      "database.after-commit-before-ack",
    );
    expect((await original.next()).kind).toBe("paused");
    const before = artifacts();
    expect(await original.next()).toEqual({
      kind: "failed",
      message: "Local identity recovery required",
    });
    await original.reap();
    expect(artifacts()).toEqual(before);
    const candidate = before.find((item) =>
      item.name.startsWith("identity.pending-"),
    )!;
    expect(rows().users.map((row) => row.user_id)).toEqual([
      decodeLocalIdentityState(candidate.bytes).principalId,
    ]);
    expect((await command("recoverInitialize")).kind).toBe("done");
    expect(fs.readFileSync(canonical())).toEqual(candidate.bytes);
  });
  it("elects one database in a simultaneous shared-identity-root operation-stage race", async () => {
    const other = SqliteDatabase.bootstrap({
      databaseRoot: path.join(parent, "other-data"),
      identityRoot: identity(),
    });
    const left = processes.start(
      database.paths.databaseRoot,
      identity(),
      "initialize",
      "operation.stage.before-create",
    );
    expect((await left.next()).kind).toBe("paused");
    const right = processes.start(
      other.paths.databaseRoot,
      identity(),
      "initialize",
      "operation.stage.before-create",
    );
    expect((await right.next()).kind).toBe("paused");
    left.child.send("continue");
    right.child.send("continue");
    const outcomes = await Promise.all([left.next(), right.next()]);
    await Promise.all([left.reap(), right.reap()]);
    expect(outcomes.filter((item) => item.kind === "done")).toHaveLength(1);
    const winner = outcomes[0].kind === "done" ? database : other,
      loser = winner === database ? other : database;
    expect(
      (
        await processes.command(
          winner.paths.databaseRoot,
          identity(),
          "recoverInitialize",
        )
      ).kind,
    ).toBe("done");
    expect(read().databaseTargetId).toBe(winner.targetId);
    const loserConnection = loser.connect();
    try {
      expect(loserConnection.get("SELECT count(*) n FROM users").n).toBe(0);
    } finally {
      loserConnection.close();
    }
    const before = artifacts();
    expect(
      (
        await processes.command(
          loser.paths.databaseRoot,
          identity(),
          "recoverInitialize",
        )
      ).kind,
    ).toBe("failed");
    expect(artifacts()).toEqual(before);
  });

  function foreignPrincipal() {
    const c = database.connect();
    try {
      c.run("INSERT INTO users VALUES(?,?,?,?)", [
        "foreign",
        "preserved@example.test",
        1,
        1,
      ]);
    } finally {
      c.close();
    }
  }
  function root() {
    fs.mkdirSync(identity(), { mode: 0o700 });
  }
  function write(name: string, bytes: Buffer) {
    fs.writeFileSync(path.join(identity(), name), bytes, { mode: 0o600 });
  }
  function candidate() {
    const state = {
      schemaVersion: 1 as const,
      databaseTargetId: database.targetId,
      principalId: token(),
      credential: token(),
      generation: 1,
    };
    const bytes = encodeLocalIdentityState(state),
      nonce = token();
    const operation = createInitializeOperation({
      databaseTargetId: database.targetId,
      nonce,
      proposedStateDigest: digestLocalIdentityState(bytes),
    });
    return { state, bytes, nonce, operation };
  }
  it.each([
    "orphans",
    "recovery-mutex",
    "operation-only",
    "operation-linked-partial-candidate",
  ])(
    "cleans pre-mutation %s without requiring empty/exact user rows",
    async (kind) => {
      foreignPrincipal();
      const before = rows();
      root();
      if (kind === "orphans" || kind === "recovery-mutex") {
        for (let index = 0; index < 64; index++)
          write(
            `identity.stage-operation-${token()}.tmp`,
            Buffer.from(index % 2 ? "partial" : ""),
          );
        if (kind === "recovery-mutex")
          write(
            "identity.operation.json",
            encodeLocalIdentityOperation(
              createRecoveryOperation({
                databaseTargetId: database.targetId,
                nonce: token(),
              }),
            ),
          );
      } else {
        const item = candidate();
        write(
          "identity.operation.json",
          encodeLocalIdentityOperation(item.operation),
        );
        if (kind === "operation-linked-partial-candidate") {
          fs.linkSync(
            path.join(identity(), "identity.operation.json"),
            path.join(identity(), `identity.stage-operation-${item.nonce}.tmp`),
          );
          write(`identity.stage-${item.nonce}-candidate.tmp`, Buffer.from("{"));
        }
      }
      expect(await command("recoverInitialize")).toMatchObject({
        kind: "done",
        generation: null,
      });
      expect(names()).toEqual([]);
      expect(rows()).toEqual(before);
    },
  );
  it.each(["recovery-stage.unlink", "recovery-stage.cleanup-dir-fsync"])(
    "resumes orphan cleanup after process death at %s",
    async (boundary) => {
      foreignPrincipal();
      const before = rows();
      root();
      for (let index = 0; index < 64; index++)
        write(
          `identity.stage-operation-${token()}.tmp`,
          Buffer.from("partial"),
        );
      const recovery = processes.start(
        database.paths.databaseRoot,
        identity(),
        "recoverInitialize",
        boundary,
      );
      expect((await recovery.next()).kind).toBe("paused");
      expect(names()).toContain("identity.operation.json");
      await recovery.terminate();
      expect(await command("recoverInitialize")).toMatchObject({
        kind: "done",
        generation: null,
      });
      expect(names()).toEqual([]);
      expect(rows()).toEqual(before);
    },
  );
  it("recovers complete candidates with redundant same-inode stages and a losing operation stage", async () => {
    root();
    const item = candidate();
    write(
      "identity.operation.json",
      encodeLocalIdentityOperation(item.operation),
    );
    write(item.operation.candidateBasename, item.bytes);
    fs.linkSync(
      path.join(identity(), "identity.operation.json"),
      path.join(identity(), `identity.stage-operation-${item.nonce}.tmp`),
    );
    fs.linkSync(
      path.join(identity(), item.operation.candidateBasename),
      path.join(identity(), `identity.stage-${item.nonce}-candidate.tmp`),
    );
    write(
      `identity.stage-operation-${token()}.tmp`,
      Buffer.from("losing unpublished stage"),
    );
    expect((await command("recoverInitialize")).kind).toBe("done");
    expect(names()).toEqual(["identity.json"]);
    expect(fs.readFileSync(canonical())).toEqual(item.bytes);
    expect(rows().users.map((row) => row.user_id)).toEqual([
      item.state.principalId,
    ]);
  });
  it.each([
    "wrong-user",
    "multiple-users",
    "foreign-binding",
    "corrupt-candidate",
    "wrong-target",
    "extra-candidate",
    "wrong-generation",
    "unexpected-link",
    "unknown-artifact",
  ])(
    "rejects %s recovery without changing artifacts or logical rows",
    async (kind) => {
      root();
      const item = candidate();
      write(
        "identity.operation.json",
        encodeLocalIdentityOperation(item.operation),
      );
      write(item.operation.candidateBasename, item.bytes);
      const c = database.connect();
      try {
        if (["wrong-user", "multiple-users"].includes(kind))
          c.run("INSERT INTO users VALUES(?,?,?,?)", [
            "foreign",
            "preserved@example.test",
            1,
            1,
          ]);
        if (kind === "multiple-users" || kind === "foreign-binding")
          c.run("INSERT INTO users VALUES(?,?,?,?)", [
            item.state.principalId,
            "local@example.test",
            1,
            1,
          ]);
        // Deliberately broken FK fixture isolates the owner predicate from the user-count predicate.
        if (kind === "foreign-binding") c.exec("PRAGMA foreign_keys=OFF");
        if (kind === "foreign-binding")
          c.run(
            "INSERT INTO external_identities(id,user_id,provider,issuer,provider_user_id,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            [
              "foreign-binding",
              "foreign",
              "auth0",
              "https://issuer.test/",
              "subject",
              "null",
              1,
              1,
            ],
          );
        if (kind === "foreign-binding") {
          expect(
            c.all("SELECT user_id FROM users").map((row) => row.user_id),
          ).toEqual([item.state.principalId]);
          expect(c.get("SELECT user_id FROM external_identities").user_id).toBe(
            "foreign",
          );
          c.exec("PRAGMA foreign_keys=ON");
        }
      } finally {
        c.close();
      }
      if (kind === "corrupt-candidate")
        write(item.operation.candidateBasename, Buffer.from("{"));
      if (kind === "wrong-target")
        write(
          item.operation.candidateBasename,
          encodeLocalIdentityState({
            ...item.state,
            databaseTargetId: token(),
          }),
        );
      if (kind === "wrong-generation") {
        const changed = encodeLocalIdentityState({
          ...item.state,
          generation: 2,
        });
        write(item.operation.candidateBasename, changed);
        write(
          "identity.operation.json",
          encodeLocalIdentityOperation({
            ...item.operation,
            proposedStateDigest: digestLocalIdentityState(changed),
          }),
        );
      }
      if (kind === "extra-candidate")
        write(`identity.pending-${token()}.json`, item.bytes);
      if (kind === "unexpected-link")
        fs.linkSync(
          path.join(identity(), item.operation.candidateBasename),
          path.join(parent, "outside-link"),
        );
      if (kind === "unknown-artifact")
        write("unknown", Buffer.from("preserve"));
      const before = artifacts(),
        beforeRows = rows();
      expect((await command("recoverInitialize")).kind).toBe("failed");
      expect(artifacts()).toEqual(before);
      expect(rows()).toEqual(beforeRows);
    },
  );
});
