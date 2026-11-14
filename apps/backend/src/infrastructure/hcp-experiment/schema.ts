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
  `CREATE TABLE fixture_bootstrap (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL CHECK(mode IN ('simulated','approved')),
    state TEXT NOT NULL CHECK(state IN ('pending','closed')), bundle TEXT NOT NULL CHECK(json_valid(bundle)),
    review_id TEXT, review_digest TEXT, review_expires INTEGER, authority_id TEXT
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
  `CREATE TABLE confirmations (
    sequence INTEGER PRIMARY KEY, entry_id TEXT NOT NULL, version INTEGER NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document)),
    FOREIGN KEY(entry_id,version) REFERENCES entry_versions(entry_id,version)
  ) STRICT`,
  `CREATE TABLE relations (
    id TEXT PRIMARY KEY, left_id TEXT NOT NULL REFERENCES entries(id), right_id TEXT NOT NULL REFERENCES entries(id),
    left_version INTEGER NOT NULL, right_version INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('contradicts','derivedFrom','supersedes','duplicates')),
    origin TEXT NOT NULL CHECK(origin IN ('provider','client','management')), owner_id TEXT NOT NULL REFERENCES entries(id),
    disposition TEXT NOT NULL CHECK(disposition IN ('open','dismissed','ended','superseded','held')),
    document TEXT NOT NULL CHECK(json_valid(document)), CHECK(left_id<>right_id),
    FOREIGN KEY(left_id,left_version) REFERENCES entry_versions(entry_id,version),
    FOREIGN KEY(right_id,right_version) REFERENCES entry_versions(entry_id,version)
  ) STRICT`,
  `CREATE TABLE quarantine_reasons (
    entry_id TEXT NOT NULL REFERENCES entries(id), relation_id TEXT NOT NULL REFERENCES relations(id),
    PRIMARY KEY(entry_id,relation_id)
  ) STRICT`,
  `CREATE TRIGGER confirmations_no_update BEFORE UPDATE ON confirmations BEGIN SELECT RAISE(ABORT,'append-only confirmation'); END`,
  `CREATE TRIGGER confirmations_no_delete BEFORE DELETE ON confirmations BEGIN SELECT RAISE(ABORT,'retained confirmation'); END`,
  `CREATE TABLE authorization_settings (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), configuration TEXT NOT NULL CHECK(json_valid(configuration)),
    human_verifier TEXT NOT NULL, secrets TEXT NOT NULL CHECK(json_valid(secrets)), policy_revision INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE client_subjects (client_id TEXT PRIMARY KEY, pseudonym TEXT NOT NULL UNIQUE) STRICT`,
  `CREATE TABLE grants (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')), document TEXT NOT NULL CHECK(json_valid(document))
  ) STRICT`,
  `CREATE TABLE grant_refs (
    grant_id TEXT NOT NULL REFERENCES grants(id), entry_id TEXT NOT NULL REFERENCES entries(id),
    ref TEXT NOT NULL UNIQUE, PRIMARY KEY(grant_id,entry_id)
  ) STRICT`,
  `CREATE TABLE grant_permissions (
    grant_id TEXT PRIMARY KEY REFERENCES grants(id), revision INTEGER NOT NULL CHECK(revision>=1)
  ) STRICT`,
  `CREATE TABLE mutation_receipts (
    key_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, grant_id TEXT NOT NULL REFERENCES grants(id),
    binding TEXT NOT NULL CHECK(json_valid(binding)), response TEXT CHECK(response IS NULL OR json_valid(response)),
    invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1)),
    CHECK(invalidated=0 OR response IS NULL)
  ) STRICT`,
  `CREATE TRIGGER receipt_binding_immutable BEFORE UPDATE OF key_hash,client_id,grant_id,binding ON mutation_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt binding'); END`,
  `CREATE TRIGGER receipt_no_restore BEFORE UPDATE ON mutation_receipts WHEN OLD.invalidated=1 BEGIN SELECT RAISE(ABORT,'invalidated receipt'); END`,
  `CREATE TRIGGER receipt_no_delete BEFORE DELETE ON mutation_receipts BEGIN SELECT RAISE(ABORT,'consumed operation'); END`,
  `CREATE TABLE consent_reviews (
    id TEXT PRIMARY KEY, interaction_id TEXT NOT NULL UNIQUE, binding_hash TEXT NOT NULL,
    csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0,
    document TEXT NOT NULL CHECK(json_valid(document))
  ) STRICT`,
  `CREATE TABLE management_reviews (
    id TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document)), consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),
    approved_capability TEXT REFERENCES person_write_capabilities(id_hash)
  ) STRICT`,
  `CREATE TABLE person_write_capabilities (
    id_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES grants(id),
    document TEXT NOT NULL CHECK(json_valid(document)), consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
  ) STRICT`,
  `CREATE TABLE staged_proposals (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
    state TEXT NOT NULL CHECK(state IN ('pending','applied','declined')), grant_id TEXT REFERENCES grants(id),
    CHECK((state='applied')=(grant_id IS NOT NULL))
  ) STRICT`,
  `CREATE TRIGGER staged_proposal_immutable BEFORE UPDATE OF id,client_id,document ON staged_proposals BEGIN SELECT RAISE(ABORT,'immutable proposal'); END`,
  `CREATE TRIGGER staged_proposal_consumed BEFORE UPDATE ON staged_proposals WHEN OLD.state<>'pending' BEGIN SELECT RAISE(ABORT,'consumed proposal'); END`,
  `CREATE TABLE policies (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('rules','directives')), document TEXT NOT NULL CHECK(json_valid(document))) STRICT`,
  `CREATE TABLE audit_cursors (id_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))) STRICT`,
  `CREATE TABLE human_sessions (id_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, authenticated INTEGER NOT NULL CHECK(authenticated IN (0,1))) STRICT`,
  `CREATE TABLE protocol_objects (
    model TEXT NOT NULL, id_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    grant_id TEXT, uid TEXT, consumed INTEGER, document TEXT NOT NULL CHECK(json_valid(document)),
    PRIMARY KEY(model,id_hash)
  ) STRICT`,
  `CREATE TRIGGER grants_no_delete BEFORE DELETE ON grants BEGIN SELECT RAISE(ABORT,'retained grant'); END`,
  `CREATE TRIGGER grants_immutable BEFORE UPDATE OF id,client_id,expires_at,document ON grants BEGIN SELECT RAISE(ABORT,'immutable grant'); END`,
  `CREATE TRIGGER refs_no_update BEFORE UPDATE ON grant_refs BEGIN SELECT RAISE(ABORT,'immutable ref'); END`,
  `CREATE TRIGGER refs_no_delete BEFORE DELETE ON grant_refs BEGIN SELECT RAISE(ABORT,'retained ref'); END`,
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
