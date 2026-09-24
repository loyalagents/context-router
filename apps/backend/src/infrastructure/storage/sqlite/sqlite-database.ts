import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  StorageConflictError,
  StorageUnavailableError,
} from "../../../domains/shared/storage/storage-errors";
import {
  SQLITE_APPLICATION_ID,
  SQLITE_SCHEMA_VERSION,
  SQLITE_SCHEMA,
  SQLITE_EXPECTED_SCHEMA,
  SQLITE_TABLES,
  normalizeSchemaSql,
} from "./sqlite-schema";
import {
  DATABASE_BASENAME,
  BOOTSTRAP_NAME,
  type LocalDatabasePaths,
  type RootPin,
  type FilePin,
  validatePaths,
  privateRoot,
  requireEmptyIdentity,
  exists,
  admitFile,
  assertDatabase,
  assertRoot,
  pin,
  regular,
  samePin,
  syncDirectory,
  syncClosedFile,
  unavailable,
} from "./sqlite-files";
import { installLike } from "./sqlite-like";

export type SqliteRow = Record<string, any>;
let nativeOwners = 0;
/** Parent coordination also reserves ownership before starting a worker. */
export function reserveSqliteOwner(): () => void {
  nativeOwners++;
  let held = true;
  return () => {
    if (held) {
      held = false;
      nativeOwners--;
    }
  };
}
function requireNoNativeOwners(): void {
  if (nativeOwners !== 0) unavailable();
}
/** Only call at a native provider boundary, never on application callback failures. */
export function sqliteFailure(error: unknown): Error {
  const code = (error as { errcode?: number })?.errcode;
  if (code === 1555 || code === 2067) return new StorageConflictError("unique");
  if (typeof code === "number" && ((code & 255) === 5 || (code & 255) === 6))
    return new StorageConflictError("serialization");
  return new StorageUnavailableError();
}
function driver(file: string): DatabaseSync {
  // 24.21's defensive default is verified by the exact-engine check and CP1 probe.
  return new DatabaseSync(`${pathToFileURL(file).href}?mode=rw`, {
    timeout: 0,
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
}
function validate(db: DatabaseSync, expectedTarget?: string): string {
  if (
    process.versions.node !== "24.21.0" ||
    db.prepare("SELECT sqlite_version() version").get().version !== "3.53.4"
  )
    unavailable();
  if (
    db.prepare("PRAGMA application_id").get().application_id !==
      SQLITE_APPLICATION_ID ||
    db.prepare("PRAGMA user_version").get().user_version !==
      SQLITE_SCHEMA_VERSION
  )
    unavailable();
  if (db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete")
    unavailable();
  const actual = db
    .prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL")
    .all()
    .map((row) => normalizeSchemaSql(String(row.sql)))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(SQLITE_EXPECTED_SCHEMA))
    unavailable();
  const metadata = db
    .prepare("SELECT singleton,target_id FROM local_metadata")
    .all();
  if (
    metadata.length !== 1 ||
    metadata[0].singleton !== 1 ||
    typeof metadata[0].target_id !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(metadata[0].target_id) ||
    (expectedTarget !== undefined && metadata[0].target_id !== expectedTarget)
  )
    unavailable();
  return metadata[0].target_id as string;
}
function configure(db: DatabaseSync): void {
  // Persistent settings are issued only after logical admission; intrinsic journal replay may precede it.
  db.exec(
    "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY",
  );
  installLike(db);
}

/** Internal connection ownership. Driver objects never cross application ports. */
export class SqliteConnection {
  private lost = false;
  private closed = false;
  private transactionOwned = false;
  private transactionFailure: Error | undefined;
  constructor(
    private readonly native: DatabaseSync,
    private readonly root: RootPin,
    private readonly filePin: FilePin,
    private readonly releaseOwner: () => void,
  ) {}
  assertPinned(): void {
    if (this.lost || this.closed) unavailable();
    try {
      assertDatabase(this.root, this.filePin);
    } catch {
      this.lost = true;
      unavailable();
    }
  }
  assertTransactionHealthy(): void {
    this.assertPinned();
    if (this.transactionFailure) throw this.transactionFailure;
  }
  private call<T>(operation: () => T): T {
    this.assertPinned();
    try {
      const result = operation();
      this.assertPinned();
      return result;
    } catch (error) {
      const failure =
        error instanceof StorageUnavailableError ? error : sqliteFailure(error);
      // Remember provider failure even if SQLite automatically rolled its transaction back.
      if (this.transactionOwned) this.transactionFailure ??= failure;
      throw failure;
    }
  }
  get(sql: string, values: SQLInputValue[] = []): SqliteRow | undefined {
    return this.call(() => this.native.prepare(sql).get(...values));
  }
  all(sql: string, values: SQLInputValue[] = []): SqliteRow[] {
    return this.call(() => this.native.prepare(sql).all(...values));
  }
  run(
    sql: string,
    values: SQLInputValue[] = [],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.call(() => this.native.prepare(sql).run(...values));
  }
  exec(sql: string): void {
    this.call(() => this.native.exec(sql));
    if (/^BEGIN(?:\s|$)/i.test(sql)) {
      this.transactionOwned = true;
      this.transactionFailure = undefined;
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") {
      this.transactionOwned = false;
      this.transactionFailure = undefined;
    }
  }
  get inTransaction(): boolean {
    return this.call(() => this.native.isTransaction);
  }
  /** Fixed observer: hash every persisted identity field without transferring row contents out of the owner. */
  identityFingerprint(): string {
    return this.call(() => {
      const digest = createHash("sha256");
      for (const sql of [
        "SELECT user_id,email,created_at,updated_at FROM users ORDER BY user_id",
        "SELECT id,user_id,provider,issuer,provider_user_id,metadata,created_at,updated_at FROM external_identities ORDER BY id",
      ]) {
        digest.update(sql).update("\n");
        for (const row of this.native.prepare(sql).iterate())
          digest.update(JSON.stringify(row)).update("\n");
      }
      return digest.digest("base64url");
    });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.native.close();
      this.releaseOwner();
    } catch {
      this.lost = true;
      unavailable();
    }
  }
}

export class SqliteDatabase {
  private constructor(
    readonly paths: LocalDatabasePaths,
    readonly targetId: string,
    private readonly root: RootPin,
    private readonly mainPin: FilePin,
  ) {}
  static open(options: LocalDatabasePaths): SqliteDatabase {
    let db: DatabaseSync | undefined;
    let release: (() => void) | undefined;
    try {
      validatePaths(options);
      const root = privateRoot(options.databaseRoot);
      const mainPin = admitFile(root);
      release = reserveSqliteOwner();
      db = driver(path.join(root.path, DATABASE_BASENAME));
      const target = validate(db, options.expectedTarget);
      assertDatabase(root, mainPin);
      return new SqliteDatabase(
        Object.freeze({ ...options }),
        target,
        root,
        mainPin,
      );
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw sqliteFailure(error);
    } finally {
      if (db) {
        try {
          db.close();
          release?.();
        } catch {
          unavailable();
        }
      } else release?.();
    }
  }
  static bootstrap(options: LocalDatabasePaths): SqliteDatabase {
    try {
      validatePaths(options);
      const canonical = path.join(options.databaseRoot, DATABASE_BASENAME);
      if (exists(canonical)) return this.open(options);
      requireNoNativeOwners();
      if (options.expectedTarget !== undefined) unavailable();
      requireEmptyIdentity(options.identityRoot);
      const root = privateRoot(options.databaseRoot, true);
      if (fs.readdirSync(root.path).length !== 0) unavailable();
      const stage = path.join(
        root.path,
        `bootstrap-${randomBytes(16).toString("hex")}.sqlite`,
      );
      const fd = fs.openSync(
        stage,
        fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_WRONLY |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      fs.closeSync(fd);
      regular(stage);
      let db: DatabaseSync | undefined;
      const release = reserveSqliteOwner();
      try {
        db = driver(stage);
        db.exec(
          "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE",
        );
        db.exec(SQLITE_SCHEMA);
        db.exec(
          `PRAGMA application_id=${SQLITE_APPLICATION_ID}; PRAGMA user_version=${SQLITE_SCHEMA_VERSION}`,
        );
        db.prepare("INSERT INTO local_metadata VALUES(1,?)").run(
          randomBytes(32).toString("base64url"),
        );
        db.exec("COMMIT");
      } finally {
        if (db) db.close();
        release();
      }
      assertRoot(root);
      if (fs.readdirSync(root.path).join() !== path.basename(stage))
        unavailable();
      syncClosedFile(stage);
      syncDirectory(root);
      fs.linkSync(stage, canonical);
      syncDirectory(root);
      const a = regular(stage, 2),
        b = regular(canonical, 2);
      if (!samePin(a, pin(b))) unavailable();
      fs.unlinkSync(stage);
      syncDirectory(root);
      return this.open(options);
    } catch {
      unavailable();
    }
  }
  /** Explicit pre-acquire recovery; callers must have terminated AND reaped all original processes. */
  static recoverBootstrap(options: LocalDatabasePaths): "none" | "recovered" {
    try {
      validatePaths(options);
      requireNoNativeOwners();
      requireEmptyIdentity(options.identityRoot);
      if (!exists(options.databaseRoot)) return "none";
      const root = privateRoot(options.databaseRoot);
      const names = fs.readdirSync(root.path).sort();
      const stages = names.filter((name) => BOOTSTRAP_NAME.test(name));
      if (names.length === 0) return "none";
      if (
        stages.length === 0 &&
        names.length === 1 &&
        names[0] === DATABASE_BASENAME
      ) {
        this.open(options);
        return "none";
      }
      if (
        stages.length !== 1 ||
        names.some((name) => name !== stages[0] && name !== DATABASE_BASENAME)
      )
        unavailable();
      const stage = path.join(root.path, stages[0]),
        canonical = path.join(root.path, DATABASE_BASENAME);
      const linked = exists(canonical),
        source = regular(stage, linked ? 2 : 1);
      if (source.size < 100) unavailable();
      if (linked && !samePin(regular(canonical, 2), pin(source))) unavailable();
      // Closed originals only. The scratch root is private and removed only after the validation handle closes.
      const scratch = fs.mkdtempSync(
        path.join(path.dirname(root.path), "database-bootstrap-check-"),
      );
      fs.chmodSync(scratch, 0o700);
      const scratchPin = privateRoot(scratch);
      let copyPin: FilePin | undefined;
      try {
        const copy = path.join(scratch, DATABASE_BASENAME);
        fs.copyFileSync(stage, copy, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(copy, 0o600);
        copyPin = pin(regular(copy));
        const checked = this.open({ ...options, databaseRoot: scratch });
        const connection = checked.connect();
        try {
          if (
            connection.get("PRAGMA integrity_check").integrity_check !== "ok" ||
            connection.all("PRAGMA foreign_key_check").length
          )
            unavailable();
          for (const table of SQLITE_TABLES)
            if (connection.get(`SELECT count(*) n FROM ${table}`).n !== 0)
              unavailable();
        } finally {
          connection.close();
        }
        assertRoot(root);
        const after = regular(stage, linked ? 2 : 1);
        if (
          !samePin(after, pin(source)) ||
          after.size !== source.size ||
          after.mtimeMs !== source.mtimeMs ||
          after.ctimeMs !== source.ctimeMs
        )
          unavailable();
        if (linked && !samePin(regular(canonical, 2), pin(source)))
          unavailable();
      } finally {
        // A validation rejection can close successfully; an uncertain close retains its reservation.
        if (nativeOwners === 0) {
          assertRoot(scratchPin);
          const copy = path.join(scratch, DATABASE_BASENAME);
          const entries = fs.readdirSync(scratch);
          if (
            entries.length === 1 &&
            entries[0] === DATABASE_BASENAME &&
            copyPin &&
            samePin(regular(copy), copyPin)
          ) {
            fs.unlinkSync(copy);
            syncDirectory(scratchPin);
            fs.rmdirSync(scratch);
          } else if (entries.length === 0) fs.rmdirSync(scratch);
          else unavailable();
        }
      }
      if (!linked) {
        syncClosedFile(stage);
        fs.linkSync(stage, canonical);
        syncDirectory(root);
      }
      fs.unlinkSync(stage);
      syncDirectory(root);
      this.open(options);
      return "recovered";
    } catch {
      unavailable();
    }
  }
  assertPinned(): void {
    assertDatabase(this.root, this.mainPin);
  }
  connect(): SqliteConnection {
    let db: DatabaseSync | undefined;
    let release: (() => void) | undefined;
    try {
      assertDatabase(this.root, this.mainPin);
      admitFile(this.root);
      release = reserveSqliteOwner();
      db = driver(path.join(this.root.path, DATABASE_BASENAME));
      validate(db, this.targetId);
      configure(db);
      assertDatabase(this.root, this.mainPin);
      return new SqliteConnection(db, this.root, this.mainPin, release);
    } catch (error) {
      if (db) {
        try {
          db.close();
          release?.();
        } catch {
          unavailable();
        }
      } else release?.();
      if (
        error instanceof StorageConflictError ||
        error instanceof StorageUnavailableError
      )
        throw error;
      throw sqliteFailure(error);
    }
  }
}
