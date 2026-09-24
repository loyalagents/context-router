import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./database.mjs";

process.umask(0o077);
const [command, dbPath] = process.argv.slice(2);
let db;
if (command === "hot") {
  db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=rw`);
  db.exec(
    "PRAGMA cache_size=2; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; UPDATE bulk SET value=zeroblob(4096)",
  );
  process.send({ ready: "hot" });
  setInterval(() => {}, 10_000);
} else if (command === "read-shared") {
  db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=rw`, {
    timeout: 0,
  });
  db.exec("BEGIN");
  const count = db.prepare("SELECT count(*) n FROM users").get().n;
  process.send({ ready: "read-shared", count });
  setInterval(() => {}, 10_000);
} else if (command === "held-before" || command === "held-after") {
  db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=rw`, {
    timeout: 0,
  });
  db.exec(
    "PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; COMMIT; BEGIN IMMEDIATE; INSERT INTO users VALUES('stable','synthetic')",
  );
  if (command === "held-after") db.exec("COMMIT");
  process.send({ ready: command });
  setInterval(() => {}, 10_000);
} else if (command === "contend") {
  db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=rw`, {
    timeout: 0,
  });
  const outcome = {};
  for (const [kind, sql] of [
    ["read", "SELECT * FROM users"],
    ["write", "INSERT INTO users VALUES ('contender','contender')"],
  ]) {
    try {
      db.exec(sql);
      outcome[kind] = "succeeded";
    } catch (error) {
      if ((error.errcode & 255) !== 5) throw error;
      outcome[kind] = "busy";
    }
  }
  db.close();
  process.send(outcome, () => process.disconnect());
} else if (command.startsWith("bootstrap-")) {
  const boundary = command.slice("bootstrap-".length);
  const stage = path.join(path.dirname(dbPath), "bootstrap-probe.sqlite");
  const result = createDatabase(stage, { commit: boundary !== "before" });
  db = result.db;
  if (boundary === "linked") fs.linkSync(stage, dbPath);
  process.send({ ready: boundary });
  setInterval(() => {}, 10_000);
} else {
  throw new Error("Invalid probe command");
}
