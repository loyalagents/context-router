import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  privateRoot,
  assertRoot,
  regular,
  pin,
  samePin,
  exists,
  syncDirectory,
  type RootPin,
  type FilePin,
} from "../filesystem/private-files";
import { inspectJournal, syncClosedFile } from "../storage/sqlite/sqlite-files";
import {
  configure,
  createSchema,
  validateSchema,
  LEASE_APPLICATION_ID,
  LEASE_SCHEMA,
} from "./schema";

export interface ExperimentPaths {
  sandbox: string;
  root: string;
}
export type FaultPoint =
  | "after-data-file"
  | "before-audit"
  | "before-commit"
  | "before-authorized-commit"
  | "after-data-commit"
  | "after-reset-intent"
  | "after-reset-unlink";
export type Fault = (point: FaultPoint) => void;
export const DATA_FILE = "entries.sqlite";
const LEASE_FILE = "lease.sqlite";
const MANIFEST = "synthetic-manifest.json";
const FILES = [
  MANIFEST,
  LEASE_FILE,
  LEASE_FILE + "-journal",
  DATA_FILE,
  DATA_FILE + "-journal",
];
const heldRoots = new Set<string>();
const refused = (): never => {
  throw new Error("HCP synthetic ownership refused");
};
export function driver(file: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(file).href}?mode=rw`, {
    timeout: 0,
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  try {
    configure(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function createFile(file: string): FilePin {
  const fd = fs.openSync(
    file,
    fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_WRONLY |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.fsyncSync(fd);
    return pin(fs.fstatSync(fd));
  } finally {
    fs.closeSync(fd);
  }
}
function checkPaths(options: ExperimentPaths): void {
  for (const p of [options.sandbox, options.root])
    if (
      typeof p !== "string" ||
      !path.isAbsolute(p) ||
      path.resolve(p) !== p ||
      p.includes("\0")
    )
      refused();
  if (
    path.dirname(options.root) !== options.sandbox ||
    options.root === options.sandbox
  )
    refused();
  privateRoot(options.sandbox);
}
function checkFiles(root: RootPin): void {
  assertRoot(root);
  for (const name of fs.readdirSync(root.path)) {
    if (!FILES.includes(name)) refused();
    regular(path.join(root.path, name));
  }
  assertRoot(root);
}
function stopped(pid: unknown): void {
  if (pid === null) return;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) refused();
  try {
    process.kill(Number(pid), 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return;
    refused();
  }
  refused(); // Includes PID reuse, live owners and zombies; no signal is sent.
}
export interface LeaseState {
  root_id: string;
  owner_pid: number | null;
  phase: "empty" | "initializing" | "ready" | "resetting";
  store_id: string | null;
  file_dev: number | null;
  file_ino: number | null;
}

/** Permanent coordination only: never holds entries, grants, credentials or audit. */
export class ExperimentLease {
  #db: DatabaseSync;
  #closed = false;
  #claimed = false;
  #manifestPin: FilePin;
  #leasePin: FilePin;
  readonly root: RootPin;
  readonly rootId: string;
  private constructor(
    root: RootPin,
    rootId: string,
    db: DatabaseSync,
    manifestPin: FilePin,
    leasePin: FilePin,
  ) {
    this.root = root;
    this.rootId = rootId;
    this.#db = db;
    this.#manifestPin = manifestPin;
    this.#leasePin = leasePin;
  }
  static acquire(
    options: ExperimentPaths,
    allowCreate = false,
  ): ExperimentLease {
    checkPaths(options);
    if (heldRoots.has(options.root)) refused();
    heldRoots.add(options.root);
    let db: DatabaseSync | undefined;
    try {
      if (!exists(options.root)) {
        if (!allowCreate) refused();
        const root = privateRoot(options.root, true);
        const rootId = randomUUID();
        const file = path.join(root.path, LEASE_FILE);
        createFile(file);
        db = driver(file);
        db.exec("BEGIN EXCLUSIVE");
        createSchema(db, LEASE_APPLICATION_ID, LEASE_SCHEMA);
        db.prepare(
          "INSERT INTO lease VALUES(1,?,NULL,'empty',NULL,NULL,NULL)",
        ).run(rootId);
        db.exec("COMMIT");
        db.close();
        db = undefined;
        syncClosedFile(file);
        syncDirectory(root);
        const manifest = {
          kind: "cr-hcp-synthetic-c1",
          version: 1,
          rootId,
          root: options.root,
          files: FILES,
        };
        const fd = fs.openSync(
          path.join(root.path, MANIFEST),
          fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            fs.constants.O_WRONLY |
            fs.constants.O_NOFOLLOW,
          0o600,
        );
        try {
          fs.writeFileSync(fd, JSON.stringify(manifest));
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        syncDirectory(root);
      }
      const root = privateRoot(options.root);
      checkFiles(root);
      const manifestFile = path.join(root.path, MANIFEST);
      const manifestPin = pin(regular(manifestFile));
      const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      if (
        m.kind !== "cr-hcp-synthetic-c1" ||
        m.version !== 1 ||
        m.root !== options.root ||
        typeof m.rootId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(m.rootId) ||
        JSON.stringify(m.files) !== JSON.stringify(FILES) ||
        Object.keys(m).sort().join() !== "files,kind,root,rootId,version"
      )
        refused();
      if (!samePin(regular(manifestFile), manifestPin)) refused();
      const file = path.join(root.path, LEASE_FILE);
      const leasePin = pin(regular(file));
      inspectJournal(file + "-journal");
      db = driver(file);
      // BEGIN EXCLUSIVE plus EXCLUSIVE mode holds the lock across all later commits.
      // Other openers can briefly hold schema-read locks before lease admission.
      // Wait only here; all owned-store operations retain their zero busy timeout.
      db.exec(
        "PRAGMA busy_timeout=1000; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE",
      );
      db.exec("PRAGMA busy_timeout=0");
      validateSchema(db, LEASE_APPLICATION_ID, LEASE_SCHEMA);
      const rows = db.prepare("SELECT * FROM lease").all();
      if (rows.length !== 1 || rows[0].root_id !== m.rootId) refused();
      stopped(rows[0].owner_pid);
      db.exec("COMMIT");
      // Native recovery ran with FULL + fullfsync before EXTRA was set. Settle
      // any journal-directory cleanup without raw-opening the live SQLite file.
      syncDirectory(root);
      const lease = new ExperimentLease(
        root,
        m.rootId,
        db,
        manifestPin,
        leasePin,
      );
      lease.assertHeld();
      return lease;
    } catch (e) {
      if (db) db.close();
      heldRoots.delete(options.root);
      throw e;
    }
  }
  assertHeld(): void {
    if (this.#closed) refused();
    checkFiles(this.root);
    if (
      !samePin(
        regular(path.join(this.root.path, MANIFEST)),
        this.#manifestPin,
      ) ||
      !samePin(regular(path.join(this.root.path, LEASE_FILE)), this.#leasePin)
    )
      refused();
  }
  claim(): void {
    this.assertHeld();
    if (this.#claimed) return;
    this.#db.exec("BEGIN EXCLUSIVE");
    this.#db
      .prepare("UPDATE lease SET owner_pid=? WHERE singleton=1")
      .run(process.pid);
    this.#db.exec("COMMIT");
    this.#claimed = true;
    this.assertHeld();
  }
  state(): LeaseState {
    this.assertHeld();
    return this.#db
      .prepare("SELECT * FROM lease")
      .get() as unknown as LeaseState;
  }
  transition(
    phase: LeaseState["phase"],
    storeId: string | null,
    file: FilePin | null,
  ): void {
    this.assertHeld();
    this.#db.exec("BEGIN EXCLUSIVE");
    try {
      this.#db
        .prepare(
          "UPDATE lease SET phase=?,store_id=?,file_dev=?,file_ino=? WHERE singleton=1",
        )
        .run(phase, storeId, file?.dev ?? null, file?.ino ?? null);
      this.#db.exec("COMMIT");
    } catch (e) {
      if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
      throw e;
    }
    this.assertHeld();
  }
  dataPin(): FilePin {
    const state = this.state();
    const p = pin(regular(path.join(this.root.path, DATA_FILE)));
    if (state.file_dev !== p.dev || state.file_ino !== p.ino || !state.store_id)
      refused();
    return p;
  }
  close(): void {
    if (this.#closed) return;
    this.assertHeld();
    if (this.#claimed) {
      this.#db.exec("BEGIN EXCLUSIVE");
      this.#db.exec("UPDATE lease SET owner_pid=NULL WHERE singleton=1");
      this.#db.exec("COMMIT");
    }
    this.#db.close();
    this.#closed = true;
    heldRoots.delete(this.root.path);
  }
}
