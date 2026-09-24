import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { localCoordinationContract } from "../integration/storage-contracts/local-coordination.contract";
import { coordinationFixture } from "./coordination.fixture";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { SqliteLocalIdentityCoordination } from "@/infrastructure/storage/sqlite/sqlite-local-identity-coordination";

localCoordinationContract("SQLite real held worker", async () =>
  coordinationFixture(),
);

describe("local held-worker ownership and deadlines", () => {
  let fixture: ReturnType<typeof coordinationFixture>;
  afterEach(async () => {
    await fixture?.dispose();
  });
  it("sanitizes pre-acquire path failures without starting a worker", async () => {
    fixture = coordinationFixture();
    fs.renameSync(
      fixture.db.paths.databaseRoot,
      path.join(fixture.parent, "private-path-canary"),
    );
    await expect(fixture.acquire()).rejects.toThrow(
      /^Local identity database unavailable$/,
    );
    expect(fixture.workers).toHaveLength(0);
  });
  it("bounds actual exit cleanup for a busy worker and retains process fencing on uncertain cleanup", async () => {
    fixture = coordinationFixture();
    const held = await fixture.acquire();
    const coordination = new SqliteLocalIdentityCoordination({
      database: fixture.db,
      deadlineMs: 150,
      workerFactory: (_file, options) => {
        const entry = path.resolve(
          __dirname,
          "../../dist/infrastructure/storage/sqlite/sqlite-coordination.worker.js",
        );
        const worker = new Worker(
          `require(${JSON.stringify(entry)}); setInterval(() => {}, 1000)`,
          { ...options, eval: true },
        );
        fixture.workers.push(worker);
        return worker;
      },
    });
    const started = Date.now();
    await expect(coordination.acquire()).rejects.toThrow("busy");
    expect(Date.now() - started).toBeLessThan(1500);
    held.assertHeld();
    await Promise.all(
      fixture.workers.slice(1).map((worker) => worker.terminate()),
    );
    await held.release();
    await expect(fixture.acquire()).rejects.toThrow("recovery required");
  });
  it.each(["begin", "snapshot", "rollback", "close"])(
    "bounds an unacknowledged %s while ownership is still held",
    async (command) => {
      let dropped = false,
        excluded = false;
      fixture = coordinationFixture({
        deadlineMs: 150,
        intercept(worker) {
          const post = worker.postMessage.bind(worker);
          worker.postMessage = (message, transfer) => {
            if (message.command === command) {
              dropped = true;
              try {
                fixture.db.connect().close();
              } catch {
                excluded = true;
              }
              return;
            }
            return post(message, transfer);
          };
        },
      });
      const held = await fixture.acquire();
      const started = Date.now();
      if (command === "close") {
        await held.initialize(fixture.state);
        await expect(held.release()).rejects.toThrow("recovery required");
      } else {
        await expect(
          held.initialize(
            fixture.state,
            command === "rollback"
              ? async () => {
                  throw new Error("callback");
                }
              : undefined,
          ),
        ).rejects.toThrow("deadline exceeded");
      }
      expect(Date.now() - started).toBeLessThan(1500);
      expect(dropped).toBe(true);
      expect(excluded).toBe(true);
      const count = fixture.queryCount();
      expect(() => held.assertHeld()).toThrow();
      await expect(held.verify(fixture.state)).rejects.toThrow();
      await held.release();
      expect(fixture.queryCount()).toBe(count);
      await Promise.all(fixture.workers.map((worker) => worker.terminate()));
      const c = fixture.db.connect();
      try {
        expect(c.get("SELECT count(*) n FROM users").n).toBe(
          command === "close" ? 1 : 0,
        );
      } finally {
        c.close();
      }
    },
  );
  it.each([
    "snapshot",
    "sparse-users",
    "sparse-identities",
    "begin",
    "commit",
    "extra-ack",
  ])(
    "terminally rejects malformed/out-of-phase %s replies",
    async (command) => {
      let injected = false;
      fixture = coordinationFixture({
        intercept(worker) {
          const commands = new Map<number, string>();
          const post = worker.postMessage.bind(worker);
          worker.postMessage = (message, transfer) => {
            commands.set(message.id, message.command);
            return post(message, transfer);
          };
          const emit = worker.emit.bind(worker);
          worker.emit = ((event: string, ...args: any[]) => {
            const target =
              command === "extra-ack"
                ? "begin"
                : command.startsWith("sparse-")
                  ? "snapshot"
                  : command;
            if (
              !injected &&
              event === "message" &&
              commands.get(args[0]?.id) === target
            ) {
              injected = true;
              args[0] = command.startsWith("sparse-")
                ? {
                    id: args[0].id,
                    ok: true,
                    value: {
                      users: command === "sparse-users" ? new Array(1) : [],
                      identities:
                        command === "sparse-identities" ? new Array(1) : [],
                    },
                  }
                : command === "snapshot"
                  ? {
                      id: args[0].id,
                      ok: true,
                      value: { users: "private-canary", identities: [] },
                    }
                  : command === "extra-ack"
                    ? { ...args[0], extra: "private-canary" }
                    : { id: args[0].id, ok: false, failure: "busy" };
            }
            return emit(event, ...args);
          }) as Worker["emit"];
        },
      });
      const held = await fixture.acquire();
      await expect(held.initialize(fixture.state)).rejects.toThrow(
        command === "commit"
          ? /^Local identity recovery required$/
          : /^Local identity database unavailable$/,
      );
      expect(injected).toBe(true);
      const count = fixture.queryCount();
      expect(() => held.assertHeld()).toThrow();
      await expect(held.verify(fixture.state)).rejects.toThrow();
      expect(fixture.queryCount()).toBe(count);
      await Promise.all(fixture.workers.map((worker) => worker.terminate()));
      await expect(fixture.acquire()).rejects.toThrow("recovery required");
    },
  );
  it("keeps the failure fence when the closed database moves to a new root in the same process", async () => {
    fixture = coordinationFixture();
    const held = await fixture.acquire();
    held.destroy();
    await Promise.all(fixture.workers.map((worker) => worker.terminate()));
    const moved = path.join(fixture.parent, "moved-data");
    fs.renameSync(fixture.db.paths.databaseRoot, moved);
    const db = SqliteDatabase.open({
      ...fixture.db.paths,
      databaseRoot: moved,
    });
    expect(db.targetId).toBe(fixture.db.targetId);
    await expect(
      new SqliteLocalIdentityCoordination({
        database: db,
        workerFactory: fixture.factory,
      }).acquire(),
    ).rejects.toThrow("recovery required");
  });
  it("observes full persisted identity changes with bounded digests and never transfers stored metadata", async () => {
    const replies: unknown[] = [];
    fixture = coordinationFixture({
      intercept(worker) {
        worker.on("message", (reply) => replies.push(reply));
      },
    });
    const first = await fixture.acquire();
    await first.initialize(fixture.state);
    await first.release();
    const before = await fixture.snapshot();
    await fixture.changeEmailAndAttachIdentity();
    const changed = await fixture.snapshot();
    expect(changed).not.toEqual(before);
    const held = await fixture.acquire();
    expect(await held.inspectIdentityRows()).toEqual(changed);
    await held.verify(fixture.state);
    expect(await held.inspectIdentityRows()).toEqual(changed);
    const output = JSON.stringify(replies);
    expect(output).not.toContain("changed@example.test");
    expect(output).not.toContain("retained");
    expect(output).not.toContain("https://issuer.test/");
    expect(replies.every((reply) => JSON.stringify(reply).length < 1000)).toBe(
      true,
    );
  });
  it("uses one release deadline across delayed close acknowledgement and actual thread exit", async () => {
    let delayed = false;
    fixture = coordinationFixture({
      deadlineMs: 500,
      keepWorkerAlive: true,
      intercept(worker) {
        let closeId: number | undefined;
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => {
          if (message.command === "close") closeId = message.id;
          return post(message, transfer);
        };
        const emit = worker.emit.bind(worker);
        worker.emit = ((event: string, ...args: any[]) => {
          if (!delayed && event === "message" && args[0]?.id === closeId) {
            delayed = true;
            setTimeout(() => emit(event, ...args), 350);
            return true;
          }
          return emit(event, ...args);
        }) as Worker["emit"];
      },
    });
    const held = await fixture.acquire();
    await held.initialize(fixture.state);
    const started = performance.now();
    await expect(held.release()).rejects.toThrow("recovery required");
    expect(delayed).toBe(true);
    expect(performance.now() - started).toBeLessThan(750);
  });
  it.each(["nul-suffix", "oversized", "unicode"])(
    "rejects exact-owner lookalike %s without unbounded row IPC",
    async (kind) => {
      const replies: unknown[] = [];
      fixture = coordinationFixture({
        intercept(worker) {
          worker.on("message", (reply) => replies.push(reply));
        },
      });
      const c = fixture.db.connect();
      try {
        const foreign =
          kind === "nul-suffix"
            ? fixture.state.principalId + "\0suffix"
            : kind === "oversized"
              ? "x".repeat(100000)
              : "😀".repeat(1000);
        c.run("INSERT INTO users VALUES(?,?,?,?)", [
          foreign,
          "private@example.test",
          1,
          1,
        ]);
        c.run(
          "INSERT INTO external_identities(id,user_id,provider,issuer,provider_user_id,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          [
            "foreign-binding",
            foreign,
            "auth0",
            "https://issuer.test/",
            "subject",
            "null",
            1,
            1,
          ],
        );
      } finally {
        c.close();
      }
      const before = await fixture.snapshot();
      const held = await fixture.acquire();
      await expect(held.initialize(fixture.state)).rejects.toThrow(
        "state conflict",
      );
      await expect(held.verify(fixture.state)).rejects.toThrow(
        "state conflict",
      );
      expect(await held.inspectIdentityRows()).toEqual(before);
      expect(
        replies.every((reply) => JSON.stringify(reply).length < 1000),
      ).toBe(true);
    },
  );
  it("rejects foreign binding ownership with exactly one matching user", async () => {
    fixture = coordinationFixture();
    const c = fixture.db.connect();
    try {
      c.run("INSERT INTO users VALUES(?,?,?,?)", [
        fixture.state.principalId,
        "owner@example.test",
        1,
        1,
      ]);
      c.exec("PRAGMA foreign_keys=OFF");
      c.run(
        "INSERT INTO external_identities(id,user_id,provider,issuer,provider_user_id,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        [
          "foreign",
          "other-owner",
          "auth0",
          "https://issuer.test/",
          "subject",
          "null",
          1,
          1,
        ],
      );
      c.exec("PRAGMA foreign_keys=ON");
    } finally {
      c.close();
    }
    const before = await fixture.snapshot(),
      held = await fixture.acquire();
    await expect(held.initialize(fixture.state)).rejects.toThrow(
      "state conflict",
    );
    await expect(held.verify(fixture.state)).rejects.toThrow("state conflict");
    expect(await held.inspectIdentityRows()).toEqual(before);
  });
  it("retains actual exclusion after acknowledged COMMIT and all pathname preflights until release", async () => {
    fixture = coordinationFixture();
    const held = await fixture.acquire();
    await held.initialize(fixture.state);
    held.assertHeld();
    expect(() => fixture.db.connect()).toThrow();
    await expect(fixture.acquire()).rejects.toThrow("busy");
    expect(await held.inspectIdentityRows()).toMatchObject({
      users: [{ user_id: fixture.state.principalId }],
    });
    await held.release();
    const c = fixture.db.connect();
    try {
      expect(c.get("SELECT count(*) n FROM users").n).toBe(1);
    } finally {
      c.close();
    }
  });
  it.each([
    undefined,
    NaN,
    { code: "SQLITE_BUSY", message: "private caller sentinel" },
  ])(
    "retains exact callback rejection %p and a usable owner after confirmed rollback",
    async (failure) => {
      fixture = coordinationFixture();
      const held = await fixture.acquire();
      let caught = false;
      try {
        await held.initialize(fixture.state, async () => {
          throw failure;
        });
      } catch (error) {
        caught = true;
        expect(Object.is(error, failure)).toBe(true);
      }
      expect(caught).toBe(true);
      expect((await held.inspectIdentityRows()).users).toHaveLength(0);
      await expect(held.initialize(fixture.state)).resolves.toBe("inserted");
    },
  );
  it("rejects a foreign logical target before database mutation", async () => {
    fixture = coordinationFixture();
    const held = await fixture.acquire();
    await expect(
      held.initialize({
        ...fixture.state,
        databaseTargetId: fixture.state.credential,
      }),
    ).rejects.toThrow();
    expect((await held.inspectIdentityRows()).users).toHaveLength(0);
  });
  it("bounds a lost COMMIT acknowledgement while the real worker still owns the lock, then refuses reacquisition in this process", async () => {
    let dropped = false,
      observedHeld = false;
    fixture = coordinationFixture({
      deadlineMs: 150,
      intercept(worker: Worker) {
        const post = worker.postMessage.bind(worker);
        let commitId: number | undefined;
        worker.postMessage = (message, transfer) => {
          if (message.command === "commit") commitId = message.id;
          return post(message, transfer);
        };
        const emit = worker.emit.bind(worker);
        worker.emit = ((event: string, ...args: any[]) => {
          if (event === "message" && args[0]?.id === commitId) {
            dropped = true;
            try {
              fixture.db.connect().close();
            } catch {
              observedHeld = true;
            }
            return true;
          }
          return emit(event, ...args);
        }) as Worker["emit"];
      },
    });
    const held = await fixture.acquire();
    const start = Date.now();
    await expect(held.initialize(fixture.state)).rejects.toThrow(
      "recovery required",
    );
    expect(Date.now() - start).toBeLessThan(1500);
    expect(dropped).toBe(true);
    expect(observedHeld).toBe(true);
    const count = fixture.queryCount();
    expect(() => held.assertHeld()).toThrow();
    await expect(held.verify(fixture.state)).rejects.toThrow();
    expect(fixture.queryCount()).toBe(count);
    await Promise.all(fixture.workers.map((worker) => worker.terminate()));
    await expect(
      new SqliteLocalIdentityCoordination({
        database: fixture.db,
        workerFactory: fixture.factory,
      }).acquire(),
    ).rejects.toThrow("recovery required");
    const c = fixture.db.connect();
    try {
      expect(c.get("SELECT count(*) n FROM users").n).toBe(1);
    } finally {
      c.close();
    }
  });
});
