import { DatabaseSync } from "node:sqlite";

export const DATA_APPLICATION_ID = 0x48435031;
export const LEASE_APPLICATION_ID = 0x48434c31;
export const SCHEMA_VERSION = 1;
export const DATA_SCHEMA = [
  `CREATE TABLE store_metadata (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), root_id TEXT NOT NULL,
    store_id TEXT NOT NULL, subject_id TEXT NOT NULL, provider_id TEXT NOT NULL,
    initialization TEXT NOT NULL CHECK(initialization='complete')
  ) STRICT`,
  `CREATE TABLE entries (
    id TEXT PRIMARY KEY, subject TEXT NOT NULL CHECK(json_valid(subject)),
    current_version INTEGER NOT NULL CHECK(current_version>=1),
    classification TEXT NOT NULL CHECK(json_valid(classification)),
    status TEXT NOT NULL CHECK(status IN ('active','deprecated','conflicted','expired','revoked','suspended','deleted')),
    FOREIGN KEY(id,current_version) REFERENCES entry_versions(entry_id,version) DEFERRABLE INITIALLY DEFERRED
  ) STRICT`,
  `CREATE TABLE entry_versions (
    entry_id TEXT NOT NULL REFERENCES entries(id) DEFERRABLE INITIALLY DEFERRED,
    version INTEGER NOT NULL CHECK(version>=1), document TEXT NOT NULL CHECK(json_valid(document)),
    valid_until INTEGER, PRIMARY KEY(entry_id,version)
  ) STRICT`,
  `CREATE TABLE audit_events (
    sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
    event TEXT NOT NULL CHECK(json_valid(event))
  ) STRICT`,
  `CREATE TRIGGER versions_no_update BEFORE UPDATE ON entry_versions BEGIN SELECT RAISE(ABORT,'immutable version'); END`,
  `CREATE TRIGGER versions_no_delete BEFORE DELETE ON entry_versions BEGIN SELECT RAISE(ABORT,'retained version'); END`,
  `CREATE TRIGGER subject_no_update BEFORE UPDATE OF id,subject ON entries BEGIN SELECT RAISE(ABORT,'immutable subject'); END`,
  `CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT,'retained entry'); END`,
  `CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'append-only audit'); END`,
  `CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'append-only audit'); END`,
];
export const LEASE_SCHEMA = [
  `CREATE TABLE lease (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), root_id TEXT NOT NULL,
    owner_pid INTEGER, phase TEXT NOT NULL CHECK(phase IN ('empty','initializing','ready','resetting')),
    store_id TEXT, file_dev INTEGER, file_ino INTEGER
  ) STRICT`,
];
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
export function validateSchema(
  db: DatabaseSync,
  applicationId: number,
  schema: string[],
): void {
  if (
    process.versions.node !== "24.21.0" ||
    db.prepare("SELECT sqlite_version() v").get().v !== "3.53.4" ||
    db.prepare("PRAGMA application_id").get().application_id !==
      applicationId ||
    db.prepare("PRAGMA user_version").get().user_version !== SCHEMA_VERSION ||
    db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete"
  )
    throw new Error("HCP schema admission refused");
  const actual = db
    .prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL")
    .all()
    .map((r) => normalize(String(r.sql)))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(schema.map(normalize).sort()))
    throw new Error("HCP schema admission refused");
  if (
    db.prepare("PRAGMA quick_check").get().quick_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    throw new Error("HCP integrity admission refused");
}
export function configure(db: DatabaseSync): void {
  // fullfsync/trusted_schema do not read the schema. synchronous does, and may
  // replay a hot journal before EXTRA takes effect (initially FULL). Set these
  // first, then sync the checked directory after recovery and before admission.
  db.exec("PRAGMA fullfsync=ON; PRAGMA trusted_schema=OFF");
  db.exec(
    "PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA busy_timeout=0",
  );
  if (
    db.prepare("PRAGMA synchronous").get().synchronous !== 3 ||
    db.prepare("PRAGMA fullfsync").get().fullfsync !== 1 ||
    db.prepare("PRAGMA foreign_keys").get().foreign_keys !== 1
  )
    throw new Error("HCP durability unavailable");
}
export function createSchema(
  db: DatabaseSync,
  applicationId: number,
  schema: string[],
): void {
  db.exec(schema.join(";") + ";");
  db.exec(
    `PRAGMA application_id=${applicationId}; PRAGMA user_version=${SCHEMA_VERSION}`,
  );
}
