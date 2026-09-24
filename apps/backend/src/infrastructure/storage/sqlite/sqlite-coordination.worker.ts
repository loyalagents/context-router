import { parentPort, workerData } from "node:worker_threads";
import { SqliteDatabase, type SqliteConnection } from "./sqlite-database";
import { StorageConflictError } from "../../../domains/shared/storage/storage-errors";
import { createSyntheticPrincipalEmail } from "../../../modules/auth/principal-identity";
import { validRequest } from "./sqlite-coordination.protocol";
import type {
  CoordinationRequest,
  CoordinationReply,
  CoordinationWorkerData,
} from "./sqlite-coordination.protocol";

const port = parentPort;
if (!port) throw new Error("Local identity database unavailable");
const data = workerData as CoordinationWorkerData;
let connection: SqliteConnection | undefined;
let terminal = false;
let lastId = 0;
function close(): void {
  connection?.close();
  connection = undefined;
  terminal = true;
}
port.on("message", (request: CoordinationRequest) => {
  if (terminal) return;
  const reply: CoordinationReply = { id: request?.id, ok: true };
  try {
    if (!validRequest(request) || request.id <= lastId) throw new Error();
    lastId = request.id;
    if (request.command === "acquire") {
      if (connection) throw new Error();
      connection = SqliteDatabase.open(data.paths).connect();
      connection.exec("PRAGMA locking_mode=EXCLUSIVE");
      // A real exclusive transaction establishes a lock that this connection retains across COMMIT.
      connection.exec("BEGIN EXCLUSIVE");
      connection.exec("COMMIT");
    } else {
      if (!connection) throw new Error();
      connection.assertTransactionHealthy();
      switch (request.command) {
        case "begin":
          connection.exec("BEGIN IMMEDIATE");
          break;
        case "snapshot":
        case "inspect":
          reply.value = {
            users: connection
              .all(
                "SELECT CASE WHEN length(CAST(user_id AS BLOB))=43 THEN user_id ELSE '' END user_id FROM users ORDER BY user_id LIMIT 2",
              )
              .map((row) => ({ user_id: row.user_id })),
            identities: connection
              .all(
                "SELECT CASE WHEN length(CAST(user_id AS BLOB))=43 THEN user_id ELSE '' END user_id FROM (SELECT DISTINCT user_id FROM external_identities ORDER BY user_id LIMIT 2)",
              )
              .map((row) => ({ user_id: row.user_id })),
            ...(request.command === "inspect"
              ? { digest: connection.identityFingerprint() }
              : {}),
          };
          break;
        case "insert-principal": {
          const id = request.principalId;
          if (
            typeof id !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(id) ||
            Buffer.from(id, "base64url").toString("base64url") !== id
          )
            throw new Error();
          const now = Date.now();
          if (
            connection.run(
              "INSERT INTO users(user_id,email,created_at,updated_at) VALUES(?,?,?,?)",
              [id, createSyntheticPrincipalEmail(id), now, now],
            ).changes !== 1
          )
            throw new Error();
          break;
        }
        case "commit":
          connection.exec("COMMIT");
          break;
        case "rollback":
          connection.exec("ROLLBACK");
          break;
        case "close":
          close();
          break;
        default:
          throw new Error();
      }
    }
  } catch (error) {
    reply.ok = false;
    reply.failure =
      request?.command === "acquire" &&
      error instanceof StorageConflictError &&
      error.kind === "serialization"
        ? "busy"
        : "unavailable";
    try {
      close();
    } catch {
      /* Parent requires actual thread exit, never infers release from an ACK. */
    }
    terminal = true;
  }
  port.postMessage(reply);
  if (terminal) port.close();
});
port.on("close", () => {
  if (!terminal) {
    try {
      close();
    } catch {
      /* Process exit closes native resources. */
    }
  }
});
