import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { inspectJournal } from "@/infrastructure/storage/sqlite/sqlite-files";
import { StorageUnavailableError } from "@/domains/shared/storage/storage-errors";

describe("optional rollback journal directory membership", () => {
  let parent: string;
  let options: { databaseRoot: string; identityRoot: string };
  beforeEach(() => {
    parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-journal-churn-")),
    );
    options = {
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    };
  });
  afterEach(() => fs.rmSync(parent, { recursive: true }));

  it.each(["before-read", "after-read", "after-write"])(
    "accepts a real journal removed by a committed competitor %s without losing the connection",
    (boundary) => {
      const database = SqliteDatabase.bootstrap(options);
      const a = database.connect(),
        b = new DatabaseSync(
          path.join(options.databaseRoot, "database.sqlite"),
        );
      const directory = fs.readdirSync;
      let reads = 0,
        witnessed = false;
      const spy = jest
        .spyOn(require("node:fs"), "readdirSync")
        .mockImplementation(((file: any, ...args: any[]) => {
          if (
            file !== options.databaseRoot ||
            ++reads !== (boundary === "before-read" ? 1 : 2)
          )
            return (directory as any)(file, ...args);
          b.exec("BEGIN IMMEDIATE");
          b.prepare(
            "INSERT INTO users VALUES('competitor','other@local.invalid',1,1)",
          ).run();
          const names = (directory as any)(file, ...args);
          expect(names).toContain("database.sqlite-journal");
          b.exec("COMMIT");
          expect(
            fs.existsSync(
              path.join(options.databaseRoot, "database.sqlite-journal"),
            ),
          ).toBe(false);
          witnessed = true;
          return names;
        }) as typeof fs.readdirSync);
      try {
        if (boundary === "after-write")
          expect(
            a.run("INSERT INTO users VALUES('caller','own@local.invalid',1,1)")
              .changes,
          ).toBe(1);
        else
          expect(a.get("SELECT count(*) n FROM users").n).toBe(
            boundary === "before-read" ? 1 : 0,
          );
        expect(witnessed).toBe(true);
        expect(a.get("SELECT count(*) n FROM users").n).toBe(
          boundary === "after-write" ? 2 : 1,
        );
        const fresh = database.connect();
        try {
          expect(fresh.get("SELECT count(*) n FROM users").n).toBe(
            boundary === "after-write" ? 2 : 1,
          );
        } finally {
          fresh.close();
        }
      } finally {
        spy.mockRestore();
        a.close();
        b.close();
      }
    },
  );

  it.each(["disappear", "content-change"])(
    "keeps strict journal inspection terminal on %s after descriptor admission",
    (kind) => {
      SqliteDatabase.bootstrap(options);
      const journal = path.join(
        options.databaseRoot,
        "database.sqlite-journal",
      );
      fs.writeFileSync(journal, Buffer.alloc(16), { mode: 0o600 });
      const actualRead = fs.readSync;
      let reached = false;
      const read = jest
        .spyOn(require("node:fs"), "readSync")
        .mockImplementation(((...args: any[]) => {
          const count = (actualRead as any)(...args);
          if (!reached) {
            reached = true;
            if (kind === "disappear") fs.unlinkSync(journal);
            else fs.appendFileSync(journal, Buffer.alloc(8));
          }
          return count;
        }) as typeof fs.readSync);
      try {
        expect(() => inspectJournal(journal)).toThrow();
        expect(reached).toBe(true);
        expect(fs.existsSync(journal)).toBe(kind !== "disappear");
        if (kind !== "disappear") expect(fs.statSync(journal).size).toBe(24);
      } finally {
        read.mockRestore();
      }
    },
  );

  it.each([
    "EACCES",
    "EIO",
    "unsafe-journal",
    "unknown-disappeared",
    "main-disappeared",
    "root-replaced",
  ])(
    "keeps %s terminal rather than treating it as optional journal absence",
    (kind) => {
      const database = SqliteDatabase.bootstrap(options),
        a = database.connect();
      const directory = fs.readdirSync,
        stat = fs.lstatSync;
      const journal = path.join(
        options.databaseRoot,
        "database.sqlite-journal",
      );
      let armed = true,
        reached = false;
      const spy = jest
        .spyOn(require("node:fs"), "readdirSync")
        .mockImplementation(((file: any, ...args: any[]) => {
          const names = (directory as any)(file, ...args);
          if (file !== options.databaseRoot || !armed) return names;
          armed = false;
          reached = true;
          if (kind === "root-replaced") {
            fs.renameSync(
              options.databaseRoot,
              path.join(parent, "original-data"),
            );
            fs.mkdirSync(options.databaseRoot, { mode: 0o700 });
            return names;
          }
          if (kind === "main-disappeared") {
            fs.renameSync(
              path.join(options.databaseRoot, "database.sqlite"),
              path.join(parent, "original-main"),
            );
            return names;
          }
          if (kind === "unsafe-journal")
            fs.writeFileSync(journal, "unsafe", { mode: 0o644 });
          return [
            ...names,
            kind === "unknown-disappeared"
              ? "unknown"
              : "database.sqlite-journal",
          ];
        }) as typeof fs.readdirSync);
      const lstat = jest
        .spyOn(require("node:fs"), "lstatSync")
        .mockImplementation(((file: any, ...args: any[]) => {
          if (file === journal && (kind === "EACCES" || kind === "EIO"))
            throw Object.assign(new Error("private path canary"), {
              code: kind,
            });
          return (stat as any)(file, ...args);
        }) as typeof fs.lstatSync);
      try {
        expect(() => a.get("SELECT 1")).toThrow(StorageUnavailableError);
        expect(reached).toBe(true);
        spy.mockRestore();
        lstat.mockRestore();
        expect(() => a.get("SELECT 1")).toThrow(StorageUnavailableError);
      } finally {
        spy.mockRestore();
        lstat.mockRestore();
        a.close();
      }
    },
  );
});
