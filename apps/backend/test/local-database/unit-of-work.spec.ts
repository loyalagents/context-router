import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SqlitePreferenceRepository } from "@/infrastructure/storage/sqlite/sqlite-preference.repository";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { SqliteStorageUnitOfWork } from "@/infrastructure/storage/sqlite/sqlite-unit-of-work";
import { SqliteIdentityStorage } from "@/infrastructure/storage/sqlite/sqlite-identity-storage";
import {
  StorageConflictError,
  StorageScopeExpiredError,
  StorageUnavailableError,
} from "@/domains/shared/storage/storage-errors";
import type { StorageScope } from "@/domains/shared/storage/storage-unit-of-work";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("real local transaction capability ownership", () => {
  let parent: string, db: SqliteDatabase, unit: SqliteStorageUnitOfWork;
  beforeEach(() => {
    parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-uow-test-")),
    );
    db = SqliteDatabase.bootstrap({
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    });
    unit = new SqliteStorageUnitOfWork(db);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(parent, { recursive: true, force: true });
  });
  function count() {
    const c = db.connect();
    try {
      return c.get("SELECT count(*) n FROM users").n;
    } finally {
      c.close();
    }
  }

  it("commits all facets together and exposes only frozen expiring methods", async () => {
    let saved!: StorageScope;
    const result = await unit.run(async (scope) => {
      saved = scope;
      expect(Object.isFrozen(scope)).toBe(true);
      for (const facet of Object.values(scope)) {
        expect(Object.isFrozen(facet)).toBe(true);
        expect(Object.getPrototypeOf(facet)).toBeNull();
        expect(
          Object.values(facet).every((value) => typeof value === "function"),
        ).toBe(true);
      }
      expect(Object.keys(scope.preferences).sort()).toEqual([
        "delete",
        "upsertActive",
        "upsertRejected",
        "upsertSuggested",
      ]);
      expect(Object.keys(scope.definitions).sort()).toEqual([
        "archive",
        "create",
        "update",
      ]);
      expect(Object.keys(scope.audit)).toEqual(["record"]);
      await scope.identity.createPrincipal("owner", "private@example.test");
      const definition = await scope.definitions.create({
        slug: "contract.scope",
        description: "Scope",
        valueType: "STRING",
        scope: "GLOBAL",
      });
      const value = await scope.preferences.upsertActive(
        "owner",
        definition.id,
        "value",
        null,
        { sourceType: "USER" },
      );
      await scope.audit.record({
        userId: "owner",
        subjectSlug: "contract.scope",
        targetType: "PREFERENCE",
        targetId: value.result.id,
        eventType: "PREFERENCE_SET",
        actorType: "USER",
        origin: "GRAPHQL",
        correlationId: "scope",
      });
      return value.result;
    });
    const c = db.connect();
    try {
      expect(c.get("SELECT count(*) n FROM user_preferences").n).toBe(1);
      expect(
        c.get("SELECT target_id FROM preference_audit_events").target_id,
      ).toBe(result.id);
    } finally {
      c.close();
    }
    const connects = jest.spyOn(db, "connect");
    await expect(saved.identity.findExact({} as never)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    await expect(saved.audit.record({} as never)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    await expect(saved.reset.deletePreferences("owner")).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    await expect(saved.preferences.delete(result.id)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    expect(connects).not.toHaveBeenCalled();
  });

  it.each([
    NaN,
    undefined,
    null,
    "caller error",
    { errcode: 2067, cause: { errcode: 5 }, secret: "caller-owned" },
  ])(
    "rolls back and preserves exact arbitrary caller rejection %p",
    async (failure) => {
      let saved!: StorageScope;
      const connects = jest.spyOn(db, "connect");
      await expect(
        unit.run(async (scope) => {
          saved = scope;
          await scope.identity.createPrincipal("owner", "owner@example.test");
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(connects).toHaveBeenCalledTimes(1);
      expect(count()).toBe(0);
      await expect(
        saved.identity.createPrincipal("later", "later@example.test"),
      ).rejects.toBeInstanceOf(StorageScopeExpiredError);
    },
  );

  it("expires an extracted method before commit acknowledgement and withholds success", async () => {
    const reached = deferred(),
      ack = deferred();
    const original = db.connect.bind(db);
    let append!: StorageScope["identity"]["createPrincipal"];
    let delivered = false;
    jest.spyOn(db, "connect").mockImplementation(() => {
      const c = original(),
        exec = c.exec.bind(c);
      jest.spyOn(c, "exec").mockImplementation((sql) => {
        if (sql === "COMMIT") {
          reached.resolve();
          return ack.promise.then(() => exec(sql)) as unknown as void;
        }
        return exec(sql);
      });
      return c;
    });
    const result = unit
      .run(async (scope) => {
        append = scope.identity.createPrincipal;
        await append("owner", "owner@example.test");
        return "committed";
      })
      .then((value) => {
        delivered = true;
        return value;
      });
    await reached.promise;
    expect(delivered).toBe(false);
    await expect(append("late", "late@example.test")).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    ack.resolve();
    await expect(result).resolves.toBe("committed");
    expect(count()).toBe(1);
  });

  it("root writes use their own connection and cannot join a held callback", async () => {
    const root = new SqliteIdentityStorage(db);
    await unit.run(async (scope) => {
      await scope.identity.createPrincipal("owner", "owner@example.test");
      await expect(
        root.createInitialProfileValue("owner", "missing", "value"),
      ).rejects.toBeInstanceOf(StorageConflictError);
    });
    expect(count()).toBe(1);
  });

  it("owns root M2M mutation and result lookup atomically against an independent connection", async () => {
    const original = db.connect.bind(db);
    let contended = false;
    jest.spyOn(db, "connect").mockImplementation(() => {
      const c = original(),
        run = c.run.bind(c);
      jest.spyOn(c, "run").mockImplementation((sql, values) => {
        const result = run(sql, values);
        if (String(sql).startsWith("INSERT INTO users") && !contended) {
          contended = true;
          const outsider = original();
          try {
            expect(() =>
              outsider.run("DELETE FROM users WHERE user_id='owner'"),
            ).toThrow(StorageConflictError);
          } finally {
            outsider.close();
          }
        }
        return result;
      });
      return c;
    });
    const row = await new SqliteIdentityStorage(db).upsertM2MPrincipal(
      "owner",
      "owner@example.test",
    );
    expect(contended).toBe(true);
    expect(row.userId).toBe("owner");
    expect(count()).toBe(1);
  });

  it("a real blocked COMMIT rejects once, rolls back the witnessed write and expires facets", async () => {
    const reader = db.connect();
    reader.exec("BEGIN");
    reader.get("SELECT count(*) n FROM users");
    let saved!: StorageScope;
    let attempts = 0;
    try {
      await expect(
        unit.run(async (scope) => {
          attempts++;
          saved = scope;
          await scope.identity.createPrincipal("owner", "owner@example.test");
          return "must not return";
        }),
      ).rejects.toMatchObject({ kind: "serialization" });
      expect(attempts).toBe(1);
      await expect(
        saved.identity.countBindings("owner"),
      ).rejects.toBeInstanceOf(StorageScopeExpiredError);
    } finally {
      reader.exec("ROLLBACK");
      reader.close();
    }
    expect(count()).toBe(0);
  });

  it("sanitizes malformed persisted JSON without leaking the stored canary", async () => {
    const id = await unit.run(async (scope) => {
      await scope.identity.createPrincipal("owner", "owner@example.test");
      const definition = await scope.definitions.create({
        slug: "contract.corrupt",
        description: "Corrupt",
        valueType: "STRING",
        scope: "GLOBAL",
      });
      return (
        await scope.preferences.upsertActive(
          "owner",
          definition.id,
          "value",
          null,
          { sourceType: "USER" },
        )
      ).result.id;
    });
    const raw = new DatabaseSync(path.join(parent, "data", "database.sqlite"));
    try {
      raw.exec("PRAGMA ignore_check_constraints=ON");
      raw
        .prepare("UPDATE user_preferences SET value=? WHERE id=?")
        .run("private-canary malformed json", id);
    } finally {
      raw.close();
    }
    const error = await new SqlitePreferenceRepository(db)
      .findById(id)
      .catch((e) => e);
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(String(error)).not.toMatch(/private-canary|JSON|token/);
    expect(error).not.toHaveProperty("cause");
  });

  it.each(["isSensitive", "isCore"] as const)(
    "rejects explicit null definition %s without changing its row",
    async (field) => {
      const row = await unit.run((scope) =>
        scope.definitions.create({
          slug: "contract.null",
          description: "Null",
          valueType: "STRING",
          scope: "GLOBAL",
          isSensitive: true,
          isCore: true,
        }),
      );
      await expect(
        unit.run((scope) =>
          scope.definitions.update(row.id, { [field]: null }),
        ),
      ).rejects.toBeInstanceOf(StorageUnavailableError);
      const c = db.connect();
      try {
        expect(
          c.get(
            "SELECT is_sensitive,is_core FROM preference_definitions WHERE id=?",
            [row.id],
          ),
        ).toEqual({ is_sensitive: 1, is_core: 1 });
      } finally {
        c.close();
      }
    },
  );

  it.each(["upsertActive", "upsertSuggested", "upsertRejected"] as const)(
    "%s preserves an omitted existing value while updating provenance",
    async (method) => {
      await unit.run(async (scope) => {
        await scope.identity.createPrincipal("owner", "owner@example.test");
        const definition = await scope.definitions.create({
          slug: "contract.omitted",
          description: "Omitted",
          valueType: "STRING",
          scope: "GLOBAL",
        });
        await scope.preferences[method](
          "owner",
          definition.id,
          "preserved",
          null,
          { sourceType: "USER" },
        );
        const next = await scope.preferences[method](
          "owner",
          definition.id,
          undefined,
          null,
          { sourceType: "IMPORTED" },
        );
        expect(next.result.value).toBe("preserved");
        expect(next.result.sourceType).toBe("IMPORTED");
        await expect(
          scope.preferences[method](
            "owner",
            definition.id,
            undefined,
            "absent",
            { sourceType: "USER" },
          ),
        ).rejects.toBeInstanceOf(StorageUnavailableError);
      });
    },
  );

  it("cannot commit earlier writes after a swallowed native transaction failure", async () => {
    let calls = 0;
    const original = db.connect.bind(db);
    jest.spyOn(db, "connect").mockImplementation(() => {
      const c = original(),
        get = c.get.bind(c);
      jest.spyOn(c, "get").mockImplementation((...args: any[]) => {
        calls++;
        return get(...args);
      });
      return c;
    });
    await expect(
      unit.run(async (scope) => {
        await scope.identity.createPrincipal("owner", "owner@example.test");
        await expect(
          scope.identity.createPrincipal("owner", "duplicate@example.test"),
        ).rejects.toMatchObject({ kind: "unique" });
        const before = calls;
        await expect(
          scope.identity.countBindings("owner"),
        ).rejects.toMatchObject({ kind: "unique" });
        expect(calls).toBe(before);
        return "must not commit";
      }),
    ).rejects.toMatchObject({ kind: "unique" });
    expect(count()).toBe(0);
  });

  it("normalizes native unique and FK errors without retaining SQL, values or causes", async () => {
    await unit.run((scope) =>
      scope.identity.createPrincipal("secret-principal", "secret-email"),
    );
    for (const [operation, expected] of [
      [
        (s: StorageScope) =>
          s.identity.createPrincipal("secret-principal", "secret-email"),
        StorageConflictError,
      ],
      [
        (s: StorageScope) =>
          s.identity.createVerifiedBinding("missing", {
            provider: "test",
            issuer: "secret",
            subject: "secret",
          }),
        StorageUnavailableError,
      ],
    ] as const) {
      const error = await unit.run<unknown>(operation).catch((e) => e);
      expect(error).toBeInstanceOf(expected);
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toMatch(/secret|SQL|constraint|database/);
    }
  });
});
