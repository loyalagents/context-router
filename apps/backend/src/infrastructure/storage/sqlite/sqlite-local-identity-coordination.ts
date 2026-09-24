import * as path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type {
  LocalIdentityCoordination,
  LocalIdentitySession,
} from "../../../domains/shared/storage/local-identity-coordination";
import {
  encodeLocalIdentityState,
  type LocalIdentityState,
} from "../../../modules/auth/local-identity-state.codec";
import { SqliteDatabase, reserveSqliteOwner } from "./sqlite-database";
import { validReply } from "./sqlite-coordination.protocol";
import type {
  CoordinationCommand,
  CoordinationReply,
  IdentityRows,
} from "./sqlite-coordination.protocol";

const poisoned = new Set<string>();
const fixed = (message: string) => new Error(`Local identity ${message}`);
export type CoordinationWorkerFactory = (
  file: string,
  options: WorkerOptions,
) => Worker;

/** One worker owns the native connection; the parent bounds observable failure without claiming native I/O interruption. */
class HeldWorker {
  private nextId = 0;
  private pending:
    | {
        id: number;
        command: CoordinationCommand;
        resolve(value: IdentityRows | undefined): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private lost = false;
  private closing = false;
  private exited = false;
  private readonly exit: Promise<void>;
  constructor(
    private readonly database: SqliteDatabase,
    private readonly worker: Worker,
    private readonly deadline: number,
    releaseOwner: () => void,
  ) {
    this.exit = new Promise((resolve) =>
      worker.once("exit", () => {
        this.exited = true;
        releaseOwner();
        if (!this.closing) this.fail();
        resolve();
      }),
    );
    worker.on("error", () => this.fail());
    worker.on("messageerror", () => this.fail());
    worker.on("message", (reply: CoordinationReply) => {
      const pending = this.pending;
      if (this.lost) return;
      if (!pending || !validReply(reply, pending.id, pending.command)) {
        this.fail();
        return;
      }
      this.pending = undefined;
      clearTimeout(pending.timer);
      if (!reply.ok) {
        if (reply.failure === "busy") {
          this.closing = true;
          pending.reject(fixed("operation busy"));
        } else {
          this.fail();
          pending.reject(fixed("database unavailable"));
        }
      } else pending.resolve(reply.value);
    });
  }
  assertHeld(): void {
    if (this.lost || this.exited || this.closing)
      throw fixed("database session is closed");
    try {
      this.database.assertPinned();
    } catch {
      this.fail();
      throw fixed("database unavailable");
    }
  }
  request(
    command: CoordinationCommand,
    principalId?: string,
  ): Promise<IdentityRows | undefined> {
    this.assertHeld();
    if (this.pending) throw fixed("database operation already in progress");
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(
        () => this.fail(fixed("database deadline exceeded")),
        this.deadline,
      );
      this.pending = { id, command, resolve, reject, timer };
      try {
        this.worker.postMessage({
          id,
          command,
          ...(principalId === undefined ? {} : { principalId }),
        });
      } catch {
        this.fail();
      }
    });
  }
  fail(error = fixed("database unavailable")): void {
    if (this.lost) return;
    this.lost = true;
    poisoned.add(this.database.targetId);
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    // Termination is requested promptly. Ownership stays reserved until the actual exit event.
    void this.worker.terminate().catch(() => undefined);
  }
  async close(): Promise<void> {
    if (this.lost) return;
    const started = performance.now();
    const reply = this.request("close");
    // Expected worker exit can race its final message; mark before awaiting acknowledgement.
    this.closing = true;
    await reply;
    await this.waitForExit(
      Math.max(1, this.deadline - (performance.now() - started)),
    );
  }
  async waitForExit(deadline: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        this.exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.fail();
            reject(fixed("database deadline exceeded"));
          }, deadline);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

class DatabaseStateConflict extends Error {}
export class SqliteLocalIdentityCoordination
  implements LocalIdentityCoordination
{
  private readonly factory: CoordinationWorkerFactory;
  private readonly deadline: number;
  constructor(
    private readonly options: {
      database: SqliteDatabase;
      deadlineMs?: number;
      workerFactory?: CoordinationWorkerFactory;
    },
  ) {
    this.factory =
      options.workerFactory ??
      ((file, workerOptions) => new Worker(file, workerOptions));
    this.deadline = options.deadlineMs ?? 15_000;
    if (!Number.isSafeInteger(this.deadline) || this.deadline < 1)
      throw fixed("database deadline invalid");
  }
  async acquire(): Promise<SqliteLocalIdentitySession> {
    const database = this.options.database;
    if (poisoned.has(database.targetId)) throw fixed("recovery required");
    try {
      database.assertPinned();
    } catch {
      throw fixed("database unavailable");
    }
    const releaseOwner = reserveSqliteOwner();
    let worker: Worker;
    try {
      worker = this.factory(
        path.join(__dirname, "sqlite-coordination.worker.js"),
        {
          workerData: {
            paths: { ...database.paths, expectedTarget: database.targetId },
          },
          env: {},
          execArgv: ["--no-global-search-paths"],
        },
      );
    } catch {
      releaseOwner();
      throw fixed("database unavailable");
    }
    const held = new HeldWorker(database, worker, this.deadline, releaseOwner);
    try {
      await held.request("acquire");
    } catch (error) {
      if ((error as Error)?.message === "Local identity operation busy") {
        // A busy reply alone is not proof of native release; wait for the actual owner exit.
        await held
          .waitForExit(Math.min(this.deadline, 1000))
          .catch(() => held.fail());
      }
      throw error;
    }
    return new SqliteLocalIdentitySession(held, database.targetId);
  }
}

export class SqliteLocalIdentitySession implements LocalIdentitySession {
  private active = true;
  private operation = false;
  private commitAttempted = false;
  constructor(
    private readonly held: HeldWorker,
    private readonly target: string,
  ) {}
  assertHeld(): void {
    if (!this.active) throw fixed("database session is closed");
    try {
      this.held.assertHeld();
    } catch {
      this.active = false;
      throw fixed(
        this.commitAttempted ? "recovery required" : "database unavailable",
      );
    }
  }
  destroy(): void {
    this.active = false;
    this.held.fail();
  }
  /** Adapter-private fixed snapshot for reconciliation and real contract observation, never arbitrary SQL. */
  async inspectIdentityRows(): Promise<IdentityRows> {
    this.assertHeld();
    return this.held.request("inspect") as Promise<IdentityRows>;
  }
  async initialize(
    state: LocalIdentityState,
    callback?: (outcome: "inserted" | "matched") => Promise<void>,
  ): Promise<"inserted" | "matched"> {
    this.validate(state);
    return this.transaction(async () => {
      const rows = await this.held.request("snapshot");
      const empty = rows.users.length === 0 && rows.identities.length === 0;
      if (!empty) this.exact(rows, state.principalId);
      const outcome = empty ? "inserted" : "matched";
      await callback?.(outcome);
      if (empty) await this.held.request("insert-principal", state.principalId);
      return outcome;
    });
  }
  async verify(
    state: LocalIdentityState,
    callback?: () => Promise<void>,
  ): Promise<void> {
    this.validate(state);
    await this.transaction(async () => {
      this.exact(await this.held.request("snapshot"), state.principalId);
      await callback?.();
    });
  }
  private validate(state: LocalIdentityState): void {
    this.assertHeld();
    encodeLocalIdentityState(state);
    if (state.databaseTargetId !== this.target) throw fixed("target mismatch");
  }
  private exact(rows: IdentityRows, principalId: string): void {
    if (
      rows.users.length !== 1 ||
      rows.users[0].user_id !== principalId ||
      rows.identities.some((row) => row.user_id !== principalId)
    )
      throw new DatabaseStateConflict();
  }
  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    this.assertHeld();
    if (this.operation) throw fixed("database operation already in progress");
    this.operation = true;
    this.commitAttempted = false;
    try {
      await this.held.request("begin");
      try {
        const result = await operation();
        this.commitAttempted = true;
        await this.held.request("commit");
        return result;
      } catch (error) {
        if (this.commitAttempted) {
          this.destroy();
          throw fixed("recovery required");
        }
        // Native/transport failure is terminal; a callback or state conflict can roll back and retain the owner.
        try {
          this.held.assertHeld();
        } catch {
          this.active = false;
          throw error;
        }
        await this.held.request("rollback");
        if (error instanceof DatabaseStateConflict)
          throw fixed("database state conflict");
        throw error;
      }
    } finally {
      this.operation = false;
    }
  }
  async release(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    try {
      await this.held.close();
    } catch {
      this.held.fail();
      throw fixed(
        this.commitAttempted
          ? "recovery required"
          : "database lock release failed",
      );
    }
  }
}
