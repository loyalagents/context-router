import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { StorageUnavailableError } from "@/domains/shared/storage/storage-errors";

describe("local database bootstrap and admission", () => {
  let parent: string;
  let options: { databaseRoot: string; identityRoot: string };
  beforeEach(() => {
    parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-db-test-")),
    );
    fs.chmodSync(parent, 0o700);
    options = {
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    };
  });
  afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));
  const main = () => path.join(options.databaseRoot, "database.sqlite");

  it("creates a complete private schema and stable logical target; reopening preserves data", () => {
    const db = SqliteDatabase.bootstrap(options);
    expect(db.targetId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fs.statSync(options.databaseRoot).mode & 0o7777).toBe(0o700);
    expect(fs.statSync(main()).mode & 0o7777).toBe(0o600);
    expect(fs.readdirSync(options.databaseRoot)).toEqual(["database.sqlite"]);
    const connection = db.connect();
    try {
      expect(connection.get("PRAGMA user_version").user_version).toBe(1);
      expect(connection.get("PRAGMA foreign_keys").foreign_keys).toBe(1);
      expect(connection.get("PRAGMA journal_mode").journal_mode).toBe("delete");
      expect(connection.get("PRAGMA synchronous").synchronous).toBe(2);
      connection.run(
        "INSERT INTO users(user_id,email,created_at,updated_at) VALUES(?,?,?,?)",
        ["principal", "local@example.test", 1, 1],
      );
    } finally {
      connection.close();
    }
    const reopened = SqliteDatabase.open(options);
    expect(reopened.targetId).toBe(db.targetId);
    const later = reopened.connect();
    try {
      expect(later.get("SELECT email FROM users").email).toBe(
        "local@example.test",
      );
    } finally {
      later.close();
    }
  });

  it("does not create an absent database through existing-only open", () => {
    expect(() => SqliteDatabase.open(options)).toThrow(StorageUnavailableError);
    expect(fs.existsSync(options.databaseRoot)).toBe(false);
  });

  it("never replaces a missing database when identity state already exists", () => {
    fs.mkdirSync(options.identityRoot, { mode: 0o700 });
    fs.writeFileSync(
      path.join(options.identityRoot, "identity.json"),
      "preserve",
      { mode: 0o600 },
    );
    expect(() => SqliteDatabase.bootstrap(options)).toThrow(
      StorageUnavailableError,
    );
    expect(
      fs.readFileSync(path.join(options.identityRoot, "identity.json"), "utf8"),
    ).toBe("preserve");
    expect(fs.existsSync(options.databaseRoot)).toBe(false);
  });

  it.each(["equal", "ancestor", "descendant"])(
    "rejects %s roots before creating anything",
    (kind) => {
      const invalid = {
        ...options,
        identityRoot:
          kind === "equal"
            ? options.databaseRoot
            : kind === "ancestor"
              ? parent
              : path.join(options.databaseRoot, "identity"),
      };
      expect(() => SqliteDatabase.bootstrap(invalid)).toThrow(
        StorageUnavailableError,
      );
      expect(fs.readdirSync(parent)).toEqual([]);
    },
  );

  it.each([
    "empty",
    "short",
    "corrupt",
    "foreign",
    "future",
    "schema",
    "target",
  ])("rejects %s state without rewriting its bytes", (kind) => {
    const db = SqliteDatabase.bootstrap(options);
    if (kind === "empty" || kind === "short" || kind === "corrupt")
      fs.writeFileSync(
        main(),
        Buffer.alloc(kind === "empty" ? 0 : kind === "short" ? 50 : 4096, 1),
      );
    else {
      const raw = new DatabaseSync(main());
      try {
        if (kind === "foreign") raw.exec("PRAGMA application_id=7");
        if (kind === "future") raw.exec("PRAGMA user_version=999");
        if (kind === "schema") raw.exec("CREATE TABLE unknown(value TEXT)");
      } finally {
        raw.close();
      }
    }
    const bytes = fs.readFileSync(main());
    expect(() =>
      SqliteDatabase.open({
        ...options,
        expectedTarget: kind === "target" ? "x".repeat(43) : db.targetId,
      }),
    ).toThrow(StorageUnavailableError);
    expect(fs.readFileSync(main())).toEqual(bytes);
    expect(fs.readdirSync(options.databaseRoot)).toEqual(["database.sqlite"]);
  });

  it.each([
    "symlink",
    "hardlink",
    "file-mode",
    "root-mode",
    "unknown",
    "wal",
    "zero-with-journal",
  ])("rejects unsafe %s before engine admission", (kind) => {
    SqliteDatabase.bootstrap(options);
    if (kind === "symlink") {
      fs.renameSync(main(), path.join(parent, "outside"));
      fs.symlinkSync(path.join(parent, "outside"), main());
    }
    if (kind === "hardlink") fs.linkSync(main(), path.join(parent, "outside"));
    if (kind === "file-mode") fs.chmodSync(main(), 0o644);
    if (kind === "root-mode") fs.chmodSync(options.databaseRoot, 0o755);
    if (kind === "unknown")
      fs.writeFileSync(path.join(options.databaseRoot, "unknown"), "preserve", {
        mode: 0o600,
      });
    if (kind === "wal")
      fs.writeFileSync(main() + "-wal", "preserve", { mode: 0o600 });
    if (kind === "zero-with-journal") {
      fs.truncateSync(main());
      fs.writeFileSync(main() + "-journal", "preserve", { mode: 0o600 });
    }
    const names = fs.readdirSync(options.databaseRoot);
    const before = names.map((name) =>
      fs.readFileSync(path.join(options.databaseRoot, name)),
    );
    expect(() => SqliteDatabase.open(options)).toThrow(StorageUnavailableError);
    expect(fs.readdirSync(options.databaseRoot)).toEqual(names);
    expect(
      names.map((name) =>
        fs.readFileSync(path.join(options.databaseRoot, name)),
      ),
    ).toEqual(before);
  });

  it("rejects a closed sidecar-free WAL-mode database without conversion or retained artifacts", () => {
    const manager = SqliteDatabase.bootstrap(options);
    const raw = new DatabaseSync(main());
    try {
      expect(raw.prepare("PRAGMA journal_mode=WAL").get().journal_mode).toBe(
        "wal",
      );
    } finally {
      raw.close();
    }
    expect(fs.readdirSync(options.databaseRoot)).toEqual(["database.sqlite"]);
    fs.mkdirSync(options.identityRoot, { mode: 0o700 });
    const identity = path.join(options.identityRoot, "identity.json");
    fs.writeFileSync(identity, "unchanged identity", { mode: 0o600 });
    const before = fs.readFileSync(main());
    expect(() => SqliteDatabase.open(options)).toThrow(StorageUnavailableError);
    let unexpected: ReturnType<SqliteDatabase["connect"]> | undefined;
    try {
      expect(() => {
        unexpected = manager.connect();
      }).toThrow(StorageUnavailableError);
    } finally {
      unexpected?.close();
    }
    expect(fs.readFileSync(main())).toEqual(before);
    expect(fs.readdirSync(options.databaseRoot)).toEqual(["database.sqlite"]);
    expect(fs.readFileSync(identity, "utf8")).toBe("unchanged identity");
  });

  it("rejects a super-journal footer without inspecting its external target", () => {
    SqliteDatabase.bootstrap(options);
    const external = path.join(parent, "external");
    fs.writeFileSync(external, "preserve", { mode: 0o600 });
    const magic = Buffer.from("d9d505f920a163d7", "hex");
    fs.writeFileSync(
      main() + "-journal",
      Buffer.concat([magic, Buffer.alloc(512), Buffer.from(external), magic]),
      { mode: 0o600 },
    );
    const before = [main(), main() + "-journal", external].map((file) =>
      fs.readFileSync(file),
    );
    expect(() => SqliteDatabase.open(options)).toThrow(StorageUnavailableError);
    expect(
      [main(), main() + "-journal", external].map((file) =>
        fs.readFileSync(file),
      ),
    ).toEqual(before);
  });

  it("pins a live main inode and fails terminally after replacement", () => {
    const db = SqliteDatabase.bootstrap(options);
    const replacement = path.join(parent, "replacement.sqlite");
    const original = path.join(parent, "original.sqlite");
    fs.copyFileSync(main(), replacement); // source is closed here
    const connection = db.connect();
    try {
      fs.renameSync(main(), original);
      fs.renameSync(replacement, main());
      expect(() => connection.get("SELECT 1")).toThrow(StorageUnavailableError);
      fs.renameSync(main(), replacement);
      fs.renameSync(original, main());
      expect(() => connection.get("SELECT 1")).toThrow(StorageUnavailableError);
    } finally {
      connection.close();
    }
  });

  it("creates private database and rollback journal even under umask zero", () => {
    const previous = process.umask(0);
    try {
      const db = SqliteDatabase.bootstrap(options);
      const c = db.connect();
      try {
        c.exec("BEGIN IMMEDIATE");
        c.run("INSERT INTO users VALUES('private','private@example.test',1,1)");
        expect(fs.statSync(main()).mode & 0o7777).toBe(0o600);
        expect(fs.statSync(main() + "-journal").mode & 0o7777).toBe(0o600);
        c.exec("ROLLBACK");
      } finally {
        c.close();
      }
    } finally {
      process.umask(previous);
    }
  });

  it.each(["absent", "empty", "canonical"])(
    "reports no bootstrap residue for %s without mutation",
    (kind) => {
      if (kind === "empty") fs.mkdirSync(options.databaseRoot, { mode: 0o700 });
      if (kind === "canonical") SqliteDatabase.bootstrap(options);
      const before = fs.existsSync(options.databaseRoot)
        ? fs.readdirSync(options.databaseRoot)
        : null;
      expect(SqliteDatabase.recoverBootstrap(options)).toBe("none");
      expect(
        fs.existsSync(options.databaseRoot)
          ? fs.readdirSync(options.databaseRoot)
          : null,
      ).toEqual(before);
    },
  );

  it.each([false, true])(
    "recovers only a closed complete empty bootstrap (linked=%s)",
    (linked) => {
      const db = SqliteDatabase.bootstrap(options);
      const stage = path.join(
        options.databaseRoot,
        "bootstrap-" + "a".repeat(32) + ".sqlite",
      );
      if (linked) fs.linkSync(main(), stage);
      else fs.renameSync(main(), stage);
      expect(() => SqliteDatabase.open(options)).toThrow(
        StorageUnavailableError,
      );
      expect(SqliteDatabase.recoverBootstrap(options)).toBe("recovered");
      expect(SqliteDatabase.open(options).targetId).toBe(db.targetId);
      expect(fs.readdirSync(options.databaseRoot)).toEqual(["database.sqlite"]);
      expect(fs.statSync(main()).nlink).toBe(1);
    },
  );

  it.each(["partial", "multiple", "populated", "unrelated", "identity"])(
    "preserves rejected bootstrap %s artifacts",
    (kind) => {
      const db = SqliteDatabase.bootstrap(options);
      if (kind === "populated") {
        const c = db.connect();
        try {
          c.run("INSERT INTO users VALUES('owner','owner@example.test',1,1)");
        } finally {
          c.close();
        }
      }
      const stage = path.join(
        options.databaseRoot,
        "bootstrap-" + "a".repeat(32) + ".sqlite",
      );
      fs.renameSync(main(), stage);
      if (kind === "partial") fs.truncateSync(stage, 0);
      if (kind === "multiple")
        fs.copyFileSync(
          stage,
          path.join(
            options.databaseRoot,
            "bootstrap-" + "b".repeat(32) + ".sqlite",
          ),
        );
      if (kind === "unrelated") fs.copyFileSync(stage, main());
      if (kind === "identity") {
        fs.mkdirSync(options.identityRoot, { mode: 0o700 });
        fs.writeFileSync(
          path.join(options.identityRoot, "identity.json"),
          "keep",
          { mode: 0o600 },
        );
      }
      const names = fs.readdirSync(options.databaseRoot).sort();
      const before = names.map((name) =>
        fs.readFileSync(path.join(options.databaseRoot, name)),
      );
      expect(() => SqliteDatabase.recoverBootstrap(options)).toThrow(
        StorageUnavailableError,
      );
      expect(fs.readdirSync(options.databaseRoot).sort()).toEqual(names);
      expect(
        names.map((name) =>
          fs.readFileSync(path.join(options.databaseRoot, name)),
        ),
      ).toEqual(before);
    },
  );

  it("rejects deleting an owner when another user references its definition, rolling back all cascades", () => {
    const db = SqliteDatabase.bootstrap(options),
      c = db.connect();
    try {
      for (const id of ["owner", "other"])
        c.run("INSERT INTO users VALUES(?,?,1,1)", [id, id + "@example.test"]);
      c.run(
        "INSERT INTO external_identities VALUES('binding','owner','test','issuer','subject',NULL,1,1)",
      );
      c.run(
        "INSERT INTO preference_definitions(id,namespace,slug,description,value_type,scope,owner_user_id,created_at,updated_at) VALUES('owned','USER:owner','test.owned','Owned','STRING','GLOBAL','owner',1,1)",
      );
      c.run(
        "INSERT INTO user_preferences(id,user_id,context_key,definition_id,value,created_at,updated_at) VALUES('foreign','other','GLOBAL','owned','true',1,1)",
      );
      expect(() => c.run("DELETE FROM users WHERE user_id='owner'")).toThrow(
        StorageUnavailableError,
      );
      expect(c.get("SELECT count(*) n FROM users").n).toBe(2);
      expect(c.get("SELECT count(*) n FROM external_identities").n).toBe(1);
      expect(c.get("SELECT count(*) n FROM preference_definitions").n).toBe(1);
      expect(c.get("SELECT count(*) n FROM user_preferences").n).toBe(1);
    } finally {
      c.close();
    }
  });

  it("keeps the full user/owned-definition/preference cascade graph and definition RESTRICT", () => {
    const db = SqliteDatabase.bootstrap(options);
    const c = db.connect();
    try {
      for (const id of ["owner", "other"])
        c.run("INSERT INTO users VALUES(?,?,1,1)", [id, id + "@example.test"]);
      c.run(
        "INSERT INTO preference_definitions(id,namespace,slug,description,value_type,scope,owner_user_id,created_at,updated_at) VALUES('owned','USER:owner','test.owned','Owned','STRING','GLOBAL','owner',1,1)",
      );
      c.run(
        "INSERT INTO preference_definitions(id,namespace,slug,description,value_type,scope,created_at,updated_at) VALUES('global','GLOBAL','test.global','Global','STRING','GLOBAL',1,1)",
      );
      c.run(
        "INSERT INTO user_preferences(id,user_id,context_key,definition_id,value,created_at,updated_at) VALUES('own-pref','owner','GLOBAL','owned','true',1,1)",
      );
      expect(() =>
        c.run("DELETE FROM preference_definitions WHERE id='owned'"),
      ).toThrow(StorageUnavailableError);
    } finally {
      c.close();
    }
    const other = db.connect();
    try {
      other.run("DELETE FROM users WHERE user_id='owner'");
      expect(other.get("SELECT count(*) n FROM user_preferences").n).toBe(0);
      expect(other.all("SELECT id FROM preference_definitions")).toEqual([
        { id: "global" },
      ]);
      expect(other.all("PRAGMA foreign_key_check")).toEqual([]);
      for (const table of [
        "external_identities",
        "locations",
        "preference_definitions",
        "user_preferences",
        "preference_audit_events",
        "mcp_access_events",
        "permission_grants",
      ]) {
        expect(
          other
            .all(`PRAGMA foreign_key_list(${table})`)
            .every((row) => row.on_update === "CASCADE"),
        ).toBe(true);
      }
      other.run(
        "INSERT INTO external_identities VALUES('binding','other','test','issuer','subject',NULL,1,1)",
      );
      other.run("UPDATE users SET user_id='renamed' WHERE user_id='other'");
      expect(
        other.get("SELECT user_id FROM external_identities WHERE id='binding'")
          .user_id,
      ).toBe("renamed");
    } finally {
      other.close();
    }
  });
});

describe("uncertain native close preserves recovery authority", () => {
  it("retains a bootstrap owner fence after a close failure instead of raw-copy recovery", () => {
    const parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-close-test-")),
    );
    const options = {
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    };
    const actualClose = DatabaseSync.prototype.close;
    let Local: typeof SqliteDatabase;
    jest.isolateModules(() => {
      Local =
        require("@/infrastructure/storage/sqlite/sqlite-database").SqliteDatabase;
    });
    // The real handle is closed for fixture cleanup; the adapter receives an uncertain close failure.
    const close = jest
      .spyOn(DatabaseSync.prototype, "close")
      .mockImplementationOnce(function (this: DatabaseSync) {
        actualClose.call(this);
        throw new Error("private native close");
      });
    try {
      expect(() => Local.bootstrap(options)).toThrow(
        "Storage operation failed",
      );
      const names = fs.readdirSync(options.databaseRoot);
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^bootstrap-/);
      expect(() => Local.recoverBootstrap(options)).toThrow(
        "Storage operation failed",
      );
      expect(fs.readdirSync(options.databaseRoot)).toEqual(names);
    } finally {
      close.mockRestore();
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("removes a validation copy after an incompatible schema rejects with a confirmed close", () => {
    const parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-invalid-copy-")),
    );
    const options = {
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    };
    try {
      SqliteDatabase.bootstrap(options);
      const main = path.join(options.databaseRoot, "database.sqlite");
      const raw = new DatabaseSync(main);
      raw.exec("PRAGMA user_version=99");
      raw.close();
      const stage = path.join(
        options.databaseRoot,
        "bootstrap-" + "a".repeat(32) + ".sqlite",
      );
      fs.renameSync(main, stage);
      expect(() => SqliteDatabase.recoverBootstrap(options)).toThrow(
        StorageUnavailableError,
      );
      expect(fs.readdirSync(parent)).toEqual(["data"]);
      expect(fs.readdirSync(options.databaseRoot)).toEqual([
        path.basename(stage),
      ]);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("preserves the private validation copy when its native close is uncertain", () => {
    const parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-copy-close-")),
    );
    const options = {
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    };
    let Local: typeof SqliteDatabase;
    jest.isolateModules(() => {
      Local =
        require("@/infrastructure/storage/sqlite/sqlite-database").SqliteDatabase;
    });
    Local.bootstrap(options);
    const stage = path.join(
      options.databaseRoot,
      "bootstrap-" + "a".repeat(32) + ".sqlite",
    );
    fs.renameSync(path.join(options.databaseRoot, "database.sqlite"), stage);
    const actualClose = DatabaseSync.prototype.close;
    const close = jest
      .spyOn(DatabaseSync.prototype, "close")
      .mockImplementationOnce(function (this: DatabaseSync) {
        actualClose.call(this);
        throw new Error("private copy close");
      });
    try {
      expect(() => Local.recoverBootstrap(options)).toThrow(
        "Storage operation failed",
      );
      const scratch = fs
        .readdirSync(parent)
        .filter((name) => name.startsWith("database-bootstrap-check-"));
      expect(scratch).toHaveLength(1);
      expect(fs.readdirSync(path.join(parent, scratch[0]))).toEqual([
        "database.sqlite",
      ]);
      expect(fs.readdirSync(options.databaseRoot)).toEqual([
        path.basename(stage),
      ]);
    } finally {
      close.mockRestore();
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
