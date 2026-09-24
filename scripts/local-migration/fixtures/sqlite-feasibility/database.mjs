// CP1-only fixture. Never imported by production backend code.
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const APP_ID = 0x43525452;
export const MAGIC = Buffer.from([
  0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7,
]);
const DDL = `
  PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
  CREATE TABLE metadata(target TEXT PRIMARY KEY CHECK(length(target)=43));
  CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL);
  CREATE TABLE identities(provider TEXT,issuer TEXT,subject TEXT,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(provider,issuer,subject));
  CREATE TABLE items(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,value TEXT NOT NULL,evidence TEXT,at INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('READ','SUGGEST','WRITE','DEFINE')),
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)));
  CREATE UNIQUE INDEX live_item ON items(user_id,slug) WHERE archived=0;
  CREATE TABLE bulk(id INTEGER PRIMARY KEY,value BLOB);
`;
const expectedSchema = DDL.split(";")
  .map((sql) => sql.trim().replace(/\s+/g, " "))
  .filter((sql) => sql.startsWith("CREATE "))
  .sort();
const connections = new Map();
export function closeOwned(root) {
  const failures = [];
  for (const [db, dbPath] of connections) {
    if (dbPath.startsWith(`${root}${path.sep}`)) {
      try {
        if (db.isOpen) db.close();
        connections.delete(db);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Probe database close failed");
}

function fixed() {
  return new Error("Database admission rejected");
}
function regular(value, links = 1) {
  const stat = fs.lstatSync(value);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.nlink !== links
  )
    throw fixed();
  return stat;
}
function same(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}
export function preflight(dbPath) {
  const root = fs.lstatSync(path.dirname(dbPath));
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    root.uid !== process.getuid() ||
    (root.mode & 0o777) !== 0o700
  )
    throw fixed();
  const database = regular(dbPath);
  if (database.size < 100) throw fixed();
  for (const suffix of ["-wal", "-shm"])
    if (fs.existsSync(`${dbPath}${suffix}`)) throw fixed();
  const journal = `${dbPath}-journal`;
  let before;
  try {
    before = regular(journal);
  } catch (error) {
    if (error.code === "ENOENT") return database;
    throw error;
  }
  const descriptor = fs.openSync(
    journal,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !same(before, opened) ||
      opened.nlink !== 1 ||
      opened.uid !== process.getuid() ||
      (opened.mode & 0o777) !== 0o600
    )
      throw fixed();
    if (opened.size > 0 && opened.size < 8)
      throw new Error("Journal admission rejected");
    if (opened.size >= 8) {
      const header = Buffer.alloc(8);
      const footer = Buffer.alloc(8);
      if (
        fs.readSync(descriptor, header, 0, 8, 0) !== 8 ||
        fs.readSync(descriptor, footer, 0, 8, opened.size - 8) !== 8
      )
        throw fixed();
      if (
        footer.equals(MAGIC) ||
        (!header.equals(MAGIC) && !header.equals(Buffer.alloc(8)))
      )
        throw new Error("Journal admission rejected");
    }
    if (
      !same(opened, fs.fstatSync(descriptor)) ||
      !same(opened, regular(journal))
    )
      throw fixed();
  } finally {
    fs.closeSync(descriptor);
  }
  if (!same(database, regular(dbPath))) throw fixed();
  return database;
}

export function createDatabase(dbPath, { commit = true } = {}) {
  if (fs.existsSync(dbPath)) throw fixed();
  const target = randomBytes(32).toString("base64url");
  const db = new DatabaseSync(dbPath, {
    timeout: 0,
    allowExtension: false,
    defensive: true,
  });
  connections.set(db, dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.exec(
    "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE",
  );
  db.exec(DDL);
  db.prepare("INSERT INTO metadata VALUES(?)").run(target);
  if (commit) {
    db.exec("COMMIT");
    db.close();
  }
  return { target, db: commit ? undefined : db };
}

export function openExisting(dbPath, target) {
  preflight(dbPath);
  const db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=rw`, {
    timeout: 0,
    allowExtension: false,
    defensive: true,
  });
  connections.set(db, dbPath);
  try {
    if (
      db.prepare("PRAGMA application_id").get().application_id !== APP_ID ||
      db.prepare("PRAGMA user_version").get().user_version !== 1
    )
      throw fixed();
    const schema = db
      .prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL")
      .all()
      .map((row) => row.sql.trim().replace(/\s+/g, " "))
      .sort();
    if (JSON.stringify(schema) !== JSON.stringify(expectedSchema))
      throw fixed();
    const rows = db.prepare("SELECT target FROM metadata").all();
    if (
      rows.length !== 1 ||
      !/^[A-Za-z0-9_-]{43}$/.test(rows[0].target) ||
      (target !== undefined && target !== rows[0].target)
    )
      throw fixed();
    db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY",
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function syncDirectory(root) {
  const descriptor = fs.openSync(root, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
function validateEmpty(dbPath) {
  const db = openExisting(dbPath);
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw fixed();
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw fixed();
    for (const table of ["users", "identities", "items", "bulk"])
      if (db.prepare(`SELECT count(*) n FROM ${table}`).get().n !== 0)
        throw fixed();
  } finally {
    db.close();
  }
}
export function recoverBootstrap(canonical) {
  const root = path.dirname(canonical);
  const stage = path.join(root, "bootstrap-probe.sqlite");
  const entries = fs.readdirSync(root).sort();
  if (
    entries.length === 0 ||
    (entries.length === 1 && entries[0] === "database.sqlite")
  )
    return "none";
  const published = fs.existsSync(canonical);
  if (
    JSON.stringify(entries) !==
    JSON.stringify(
      published
        ? ["bootstrap-probe.sqlite", "database.sqlite"]
        : ["bootstrap-probe.sqlite"],
    )
  )
    throw fixed();
  if (published) {
    const source = regular(stage, 2);
    const main = regular(canonical, 2);
    if (!same(source, main)) throw fixed();
    const scratch = fs.mkdtempSync(
      path.join(os.tmpdir(), "step05-bootstrap-copy-"),
    );
    try {
      const copy = path.join(scratch, "database.sqlite");
      fs.copyFileSync(stage, copy, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(copy, 0o600);
      validateEmpty(copy);
      if (
        !same(source, regular(stage, 2)) ||
        !same(main, regular(canonical, 2))
      )
        throw fixed();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  } else {
    validateEmpty(stage);
    fs.linkSync(stage, canonical);
    syncDirectory(root);
  }
  fs.unlinkSync(stage);
  syncDirectory(root);
  regular(canonical);
  return "recovered";
}
