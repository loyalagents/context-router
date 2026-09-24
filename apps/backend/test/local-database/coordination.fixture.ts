import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import {
  SqliteLocalIdentityCoordination,
  SqliteLocalIdentitySession,
} from "@/infrastructure/storage/sqlite/sqlite-local-identity-coordination";
import type { CoordinationFixture } from "../integration/storage-contracts/local-coordination.contract";

export function coordinationFixture(
  options: {
    keepWorkerAlive?: boolean;
    deadlineMs?: number;
    intercept?: (worker: Worker) => void;
  } = {},
) {
  const parent = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "local-held-test-")),
  );
  const db = SqliteDatabase.bootstrap({
    databaseRoot: path.join(parent, "data"),
    identityRoot: path.join(parent, "identity"),
  });
  const state = {
    schemaVersion: 1 as const,
    databaseTargetId: db.targetId,
    principalId: randomBytes(32).toString("base64url"),
    credential: randomBytes(32).toString("base64url"),
    generation: 1,
  };
  const workers: Worker[] = [],
    handles: SqliteLocalIdentitySession[] = [];
  let count = 0;
  const factory = (_file: string, opts: WorkerOptions) => {
    const entry = path.resolve(
      __dirname,
      "../../dist/infrastructure/storage/sqlite/sqlite-coordination.worker.js",
    );
    const worker = options.keepWorkerAlive
      ? new Worker(
          `require(${JSON.stringify(entry)}); setInterval(() => {}, 1000)`,
          { ...opts, eval: true },
        )
      : new Worker(entry, opts);
    workers.push(worker);
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (...args: Parameters<Worker["postMessage"]>) => {
      count++;
      return post(...args);
    };
    options.intercept?.(worker);
    return worker;
  };
  const coordination = new SqliteLocalIdentityCoordination({
    database: db,
    workerFactory: factory,
    deadlineMs: options.deadlineMs,
  });
  const acquire = async () => {
    const handle = await coordination.acquire();
    handles.push(handle);
    return handle;
  };
  const snapshot = async () => {
    const active = [...handles].reverse().find((handle) => {
      try {
        handle.assertHeld();
        return true;
      } catch {
        return false;
      }
    });
    if (active) return active.inspectIdentityRows();
    const c = db.connect();
    try {
      return {
        users: c
          .all(
            "SELECT CASE WHEN length(CAST(user_id AS BLOB))=43 THEN user_id ELSE '' END user_id FROM users ORDER BY user_id LIMIT 2",
          )
          .map((row) => ({ user_id: row.user_id })),
        identities: c
          .all(
            "SELECT CASE WHEN length(CAST(user_id AS BLOB))=43 THEN user_id ELSE '' END user_id FROM (SELECT DISTINCT user_id FROM external_identities ORDER BY user_id LIMIT 2)",
          )
          .map((row) => ({ user_id: row.user_id })),
        digest: c.identityFingerprint(),
      };
    } finally {
      c.close();
    }
  };
  const fixture: CoordinationFixture = {
    state,
    acquire,
    snapshot,
    createForeignPrincipal: async () => {
      const c = db.connect();
      try {
        c.run("INSERT INTO users VALUES(?,?,?,?)", [
          "foreign",
          "foreign@example.test",
          1,
          1,
        ]);
      } finally {
        c.close();
      }
    },
    changeEmailAndAttachIdentity: async () => {
      const c = db.connect();
      try {
        c.run("UPDATE users SET email=?, updated_at=? WHERE user_id=?", [
          "changed@example.test",
          17,
          state.principalId,
        ]);
        c.run(
          "INSERT INTO external_identities(id,user_id,provider,issuer,provider_user_id,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          [
            "binding",
            state.principalId,
            "auth0",
            "https://issuer.test/",
            "subject",
            '{"retained":true}',
            19,
            23,
          ],
        );
      } finally {
        c.close();
      }
    },
    loseHeldConnection: () => handles.at(-1)!.destroy(),
    queryCount: () => count,
    dispose: async () => {
      const releases = await Promise.allSettled(
        handles.map((handle) => handle.release()),
      );
      const deaths = await Promise.allSettled(
        workers.map((worker) => worker.terminate()),
      );
      if (
        workers.some((worker) => worker.threadId !== -1) ||
        deaths.some((result) => result.status === "rejected")
      )
        throw new Error("Owned worker cleanup uncertain; fixture retained");
      fs.rmSync(parent, { recursive: true, force: true });
      // Failed/lost sessions intentionally have idempotent release; unexpected release failure still fails cleanup.
      const failed = releases.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
  };
  return {
    ...fixture,
    acquire,
    db,
    parent,
    workers,
    handles,
    coordination,
    factory,
  };
}
