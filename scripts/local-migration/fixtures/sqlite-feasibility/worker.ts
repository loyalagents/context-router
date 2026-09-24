// Compiled into a standalone private directory by the CP1 test. No source lookup.
import { DatabaseSync, backup } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const port = parentPort!;
let db: DatabaseSync | undefined;
let terminal = false;
let inFlight = false;
interface Request {
  id: number;
  command: string;
  principal?: string;
  snapshot?: string;
}
port.on("message", async (request: Request) => {
  if (terminal || inFlight) {
    port.postMessage({ id: request.id, error: "terminal" });
    return;
  }
  inFlight = true;
  try {
    let result: unknown;
    switch (request.command) {
      case "acquire":
        db = new DatabaseSync(
          `${pathToFileURL(workerData.dbPath).href}?mode=rw`,
          { timeout: 0, allowExtension: false },
        );
        if (
          db.prepare("SELECT target FROM metadata").get()?.target !==
          workerData.target
        )
          throw new Error("target");
        db.exec(
          "PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; COMMIT",
        );
        break;
      case "begin":
        db!.exec("BEGIN IMMEDIATE");
        break;
      case "insert":
        db!
          .prepare("INSERT INTO users VALUES (?, 'synthetic')")
          .run(request.principal!);
        break;
      case "touch":
        db!.exec("UPDATE users SET email='committed-without-acknowledgement'");
        break;
      case "count":
        result = db!.prepare("SELECT count(*) n FROM users").get()!.n;
        break;
      case "commit":
        db!.exec("COMMIT");
        break;
      case "rollback":
        db!.exec("ROLLBACK");
        break;
      case "backup":
        await backup(db!, request.snapshot!);
        break;
      case "close":
        db!.close();
        db = undefined;
        break;
      case "stall":
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        break;
      case "commit-and-stall":
        db!.exec("COMMIT");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        break;
      default:
        throw new Error("command");
    }
    port.postMessage({ id: request.id, result });
  } catch {
    terminal = true;
    try {
      db?.close();
    } catch {
      /* the parent treats this worker as lost */
    }
    port.postMessage({ id: request.id, error: "probe storage failed" });
  } finally {
    inFlight = false;
  }
});
