import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { withConfirmations } from "./entry-state";
import { evaluateWrite, causalTransitions } from "./conflict-graph";
import { storedEntry } from "./writes";
import {
  regular,
  pin,
  samePin,
  exists,
  syncDirectory,
  type FilePin,
} from "../filesystem/private-files";
import { inspectJournal, syncClosedFile } from "../storage/sqlite/sqlite-files";
import {
  DATA_APPLICATION_ID,
  DATA_SCHEMA,
  createSchema,
  validateSchema,
} from "./schema";
import {
  ExperimentLease,
  DATA_FILE,
  createFile,
  driver,
  type ExperimentPaths,
  type Fault,
} from "./ownership";
import {
  syntheticFixtures,
  validateFixtures,
  type SyntheticFixture,
} from "./fixtures";
import {
  AuthorizationRepository,
  expireGrants,
  type AuthorizationConfiguration,
} from "./authority";
import { AuthorityError } from "./policy";
import { insertFixtures } from "./seed";

// Internal operator inspection only. No context-client, disclosure or management authorization API.
export interface StoredEntry {
  [key: string]: any;
  id: string;
  subject: any;
  content: any;
  record: any;
}
export interface AuditEvent {
  [key: string]: any;
  eventType: string;
  timestamp: string;
  data: any;
}
export interface ExperimentOptions {
  clock?: () => number;
  fault?: Fault;
  fixtures?: SyntheticFixture[];
  pendingApproval?: boolean;
}
const uuid = () => `urn:uuid:${randomUUID()}`;
const timestamp = (clock: () => number): string => {
  const n = clock();
  if (!Number.isSafeInteger(n)) throw new Error("Invalid experiment clock");
  return new Date(n).toISOString();
};
function dataConnection(lease: ExperimentLease): DatabaseSync {
  const file = path.join(lease.root.path, DATA_FILE);
  const expected = lease.dataPin();
  inspectJournal(file + "-journal");
  const db = driver(file);
  try {
    validateSchema(db, DATA_APPLICATION_ID, DATA_SCHEMA);
    const rows = db.prepare("SELECT * FROM store_metadata").all();
    if (
      rows.length !== 1 ||
      rows[0].root_id !== lease.rootId ||
      rows[0].store_id !== lease.state().store_id ||
      rows[0].initialization !== "complete"
    )
      throw new Error("HCP data identity refused");
    if (!samePin(regular(file), expected)) throw new Error("HCP data pin lost");
    // Complete native replay/cleanup durability before admitting a handle.
    // A directory descriptor cannot cancel SQLite's file locks.
    syncDirectory(lease.root);
    lease.assertHeld();
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
function append(db: DatabaseSync, event: AuditEvent, fault?: Fault): void {
  fault?.("before-audit");
  db.prepare("INSERT INTO audit_events(event_id,event) VALUES(?,?)").run(
    event.eventId,
    JSON.stringify(event),
  );
}
function seed(
  db: DatabaseSync,
  rootId: string,
  storeId: string,
  fixtures: SyntheticFixture[],
  clock: () => number,
  fault?: Fault,
  pendingApproval = false,
): void {
  db.prepare("INSERT INTO store_metadata VALUES(1,?,?,?,?,'complete')").run(
    rootId,
    storeId,
    uuid(),
    uuid(),
  );
  db.prepare(
    "INSERT INTO fixture_bootstrap VALUES(1,?,?,?,NULL,NULL,NULL,NULL)",
  ).run(
    pendingApproval ? "approved" : "simulated",
    pendingApproval ? "pending" : "closed",
    JSON.stringify(fixtures),
  );
  if (!pendingApproval)
    insertFixtures(db, fixtures, clock, (event) => append(db, event, fault));
}

export class SyntheticExperiment {
  #db: DatabaseSync;
  #lease: ExperimentLease;
  #filePin: FilePin;
  #closed = false;
  #failed = false;
  #clock: () => number;
  #fault?: Fault;
  readonly storeId: string;
  private constructor(
    db: DatabaseSync,
    lease: ExperimentLease,
    options: ExperimentOptions,
  ) {
    this.#db = db;
    this.#lease = lease;
    this.#filePin = lease.dataPin();
    this.storeId = lease.state().store_id!;
    this.#clock = options.clock ?? Date.now;
    this.#fault = options.fault;
  }
  static create(
    paths: ExperimentPaths,
    options: ExperimentOptions = {},
  ): SyntheticExperiment {
    // Validate before creating a root or recording any fixture history.
    const fixtures = validateFixtures(options.fixtures ?? syntheticFixtures());
    const lease = ExperimentLease.acquire(paths, true);
    let db: DatabaseSync | undefined;
    try {
      if (
        lease.state().phase !== "empty" ||
        exists(path.join(paths.root, DATA_FILE))
      )
        throw new Error("HCP initialization requires empty owned store");
      lease.claim();
      const storeId = uuid();
      lease.transition("initializing", storeId, null);
      const file = path.join(paths.root, DATA_FILE);
      const filePin = createFile(file);
      syncDirectory(lease.root);
      lease.transition("initializing", storeId, filePin);
      options.fault?.("after-data-file");
      db = driver(file);
      db.exec("BEGIN IMMEDIATE");
      try {
        createSchema(db, DATA_APPLICATION_ID, DATA_SCHEMA);
        seed(
          db,
          lease.rootId,
          storeId,
          fixtures,
          options.clock ?? Date.now,
          options.fault,
          options.pendingApproval,
        );
        options.fault?.("before-commit");
        lease.assertHeld();
        db.exec("COMMIT");
        options.fault?.("after-data-commit");
      } catch (e) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw e;
      }
      db.close();
      db = undefined;
      syncClosedFile(file);
      syncDirectory(lease.root);
      lease.transition("ready", storeId, filePin);
      db = dataConnection(lease);
      const result = new SyntheticExperiment(db, lease, options);
      result.reconcile();
      return result;
    } catch (e) {
      if (db) db.close();
      lease.close();
      throw e;
    }
  }
  static open(
    paths: ExperimentPaths,
    options: ExperimentOptions = {},
  ): SyntheticExperiment {
    const lease = ExperimentLease.acquire(paths);
    let db: DatabaseSync | undefined;
    try {
      const state = lease.state();
      if (state.phase !== "ready" && state.phase !== "initializing")
        throw new Error("HCP store is not ready");
      db = dataConnection(lease);
      lease.claim();
      if (state.phase === "initializing") {
        // Complete transaction (including fixtures/audit) proved by its marker; no partial repair.
        db.close();
        db = undefined;
        syncClosedFile(path.join(paths.root, DATA_FILE));
        syncDirectory(lease.root);
        lease.transition("ready", state.store_id, lease.dataPin());
        db = dataConnection(lease);
      }
      const result = new SyntheticExperiment(db, lease, options);
      result.reconcile(); // No handle/read admission until overdue state AND audit commit.
      return result;
    } catch (e) {
      if (db) db.close();
      lease.close();
      throw e;
    }
  }
  #assert(): void {
    if (this.#closed || this.#failed)
      throw new Error("HCP experiment admission closed");
    try {
      this.#lease.assertHeld();
      if (
        !samePin(
          regular(path.join(this.#lease.root.path, DATA_FILE)),
          this.#filePin,
        )
      )
        throw new Error("HCP data pin lost");
    } catch (e) {
      this.#failed = true;
      throw e;
    }
  }
  private reconcile(): void {
    this.#assert();
    try {
      // A durable commit may cross another deadline (sleep or slow I/O).
      // Re-sample until no currently overdue entries remain before admission.
      for (;;) {
        const at = timestamp(this.#clock);
        const overdue = this.#db
          .prepare(
            `SELECT e.id,e.status,e.current_version,e.classification,v.valid_until
        FROM entries e JOIN entry_versions v ON e.id=v.entry_id AND e.current_version=v.version
        WHERE v.valid_until<=? AND e.status NOT IN ('expired','deleted','revoked') ORDER BY e.id`,
          )
          .all(Date.parse(at));
        const expiredGrants = Number(
          this.#db
            .prepare(
              "SELECT count(*) n FROM grants WHERE status='active' AND expires_at<=?",
            )
            .get(Date.parse(at)).n,
        );
        if (!overdue.length && !expiredGrants) return;
        this.#db.exec("BEGIN IMMEDIATE");
        const providerId = String(
          this.#db.prepare("SELECT provider_id FROM store_metadata").get()
            .provider_id,
        );
        for (const row of overdue) {
          const previous = storedEntry(this.#db, String(row.id));
          const relatedBefore = previous.record.relationships.map((r: any) => ({
            id: r.target,
            before: storedEntry(this.#db, r.target)?.record.status ?? null,
          }));
          this.#db
            .prepare("UPDATE entries SET status='expired' WHERE id=?")
            .run(row.id);
          const actor = { role: "hcp-provider", id: providerId };
          const graphChanges: any[] = [];
          evaluateWrite(
            this.#db,
            String(row.id),
            previous,
            Date.parse(at),
            actor,
            (change) => {
              if (!change.eventType) {
                graphChanges.push(change);
                return;
              }
              append(
                this.#db,
                {
                  eventId: uuid(),
                  eventType: change.eventType,
                  timestamp: at,
                  participants: {
                    initiator: actor,
                    provider: { id: providerId },
                  },
                  entryId: change.entryId,
                  relatedEntryId: change.relatedEntryId,
                  categories: [
                    ...new Set(
                      [change.entryId, change.relatedEntryId].flatMap(
                        (id) =>
                          storedEntry(this.#db, id)?.classification
                            .categories ?? [],
                      ),
                    ),
                  ],
                  grantId: null,
                  data: change.data,
                },
                this.#fault,
              );
            },
          );
          append(
            this.#db,
            {
              eventId: uuid(),
              eventType: "context.expired",
              timestamp: timestamp(this.#clock),
              participants: {
                initiator: { role: "hcp-provider", id: providerId },
                provider: { id: providerId },
              },
              entryId: row.id,
              relatedEntryId: null,
              categories: JSON.parse(String(row.classification)).categories,
              grantId: null,
              data: {
                version: row.current_version,
                effectiveAt: new Date(Number(row.valid_until)).toISOString(),
                previousStatus: row.status,
                status: "expired",
                relationships: {
                  before: previous.record.relationships,
                  after: storedEntry(this.#db, String(row.id)).record
                    .relationships,
                },
                relatedTransitions: [
                  ...relatedBefore.map((t: any) => ({
                    ...t,
                    after: storedEntry(this.#db, t.id)?.record.status ?? null,
                  })),
                  ...causalTransitions(graphChanges),
                ],
                graphChanges,
              },
            },
            this.#fault,
          );
        }
        expireGrants(this.#db, Date.parse(at), (event) =>
          append(this.#db, event, this.#fault),
        );
        this.#fault?.("before-commit");
        this.#assert();
        this.#db.exec("COMMIT");
        this.#fault?.("after-data-commit");
      }
    } catch (e) {
      this.#failed = true;
      if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
      throw e;
    }
  }
  inspectEntries(): StoredEntry[] {
    this.reconcile();
    return this.#db
      .prepare(
        "SELECT e.*,v.document FROM entries e JOIN entry_versions v ON v.entry_id=e.id AND v.version=e.current_version ORDER BY e.id",
      )
      .all()
      .map((row) => this.assemble(row));
  }
  inspectEntry(id: string, version?: number): StoredEntry | undefined {
    this.reconcile();
    const row = this.#db
      .prepare(
        "SELECT e.*,v.document FROM entries e JOIN entry_versions v ON v.entry_id=e.id AND v.version=coalesce(?,e.current_version) WHERE e.id=?",
      )
      .get(version ?? null, id);
    return row ? this.assemble(row) : undefined;
  }
  private assemble(row: Record<string, any>): StoredEntry {
    const doc = JSON.parse(row.document);
    return withConfirmations(this.#db, {
      ...doc,
      subject: JSON.parse(row.subject),
      classification: JSON.parse(row.classification),
      record: { ...doc.record, status: row.status },
    });
  }
  inspectAudit(): AuditEvent[] {
    this.reconcile();
    return this.#db
      .prepare("SELECT event FROM audit_events ORDER BY sequence")
      .all()
      .map((r) => JSON.parse(String(r.event)));
  }
  authorization(
    configuration: AuthorizationConfiguration,
    humanCredential: string,
  ): AuthorizationRepository {
    // Method-only infrastructure boundary; no database handle reaches the HTTP composition.
    return new AuthorizationRepository(
      {
        read: (operation) => {
          this.reconcile();
          return operation(this.#db);
        },
        write: (operation, beforeCommit) => {
          this.reconcile();
          this.#db.exec("BEGIN IMMEDIATE");
          try {
            const result = operation(this.#db);
            if (result && typeof (result as any).then === "function")
              throw new Error("Asynchronous HCP transaction refused");
            this.#fault?.("before-commit");
            this.#assert();
            if (beforeCommit) this.#fault?.("before-authorized-commit");
            beforeCommit?.();
            this.#db.exec("COMMIT");
            this.#fault?.("after-data-commit");
            return result;
          } catch (error) {
            if (!(error instanceof AuthorityError)) this.#failed = true;
            if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
            throw error;
          }
        },
        now: () => Date.parse(timestamp(this.#clock)),
        append: (db, event) => append(db, event, this.#fault),
      },
      configuration,
      humanCredential,
    );
  }
  settings() {
    this.#assert();
    return {
      journalMode: this.#db.prepare("PRAGMA journal_mode").get().journal_mode,
      synchronous: this.#db.prepare("PRAGMA synchronous").get().synchronous,
      fullfsync: this.#db.prepare("PRAGMA fullfsync").get().fullfsync,
      foreignKeys: this.#db.prepare("PRAGMA foreign_keys").get().foreign_keys,
    };
  }
  close(): void {
    if (this.#closed) return;
    // Do not clear the lease unless closing the data connection succeeded.
    this.#db.close();
    this.#failed = true;
    this.#lease.close();
    this.#closed = true;
  }
}

export function resetSyntheticStore(
  paths: ExperimentPaths,
  fault?: Fault,
): void {
  const lease = ExperimentLease.acquire(paths);
  try {
    const state = lease.state();
    const file = path.join(paths.root, DATA_FILE);
    if (state.phase === "empty") {
      if (exists(file) || exists(file + "-journal"))
        throw new Error("Unexpected empty-store data");
      return;
    }
    if (
      state.phase !== "ready" &&
      state.phase !== "resetting" &&
      state.phase !== "initializing"
    )
      throw new Error("HCP reset refused");
    if (exists(file)) {
      const p = lease.dataPin();
      const db = dataConnection(lease);
      db.close(); // Includes native journal recovery, then full admission.
      if (exists(file + "-journal"))
        throw new Error("Unexpected journal after closed recovery");
      lease.claim();
      lease.transition("resetting", state.store_id, p);
      fault?.("after-reset-intent");
      lease.assertHeld();
      if (!samePin(regular(file), p)) throw new Error("HCP reset pin lost");
      fs.unlinkSync(file);
      fault?.("after-reset-unlink");
      syncDirectory(lease.root);
    } else {
      if (
        state.phase !== "resetting" ||
        exists(file + "-journal") ||
        !state.store_id ||
        state.file_ino === null ||
        state.file_dev === null
      )
        throw new Error("Unproven missing data");
      syncDirectory(lease.root);
    }
    lease.claim();
    lease.transition("empty", null, null);
  } finally {
    lease.close();
  }
}
