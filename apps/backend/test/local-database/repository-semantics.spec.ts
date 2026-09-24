import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { SqliteUserRepository } from "@/infrastructure/storage/sqlite/sqlite-user.repository";
import { SqliteExternalIdentityRepository } from "@/infrastructure/storage/sqlite/sqlite-external-identity.repository";
import { SqlitePermissionGrantRepository } from "@/infrastructure/storage/sqlite/sqlite-permission-grant.repository";
import { SqliteLocationRepository } from "@/infrastructure/storage/sqlite/sqlite-location.repository";
import { SqliteCatalogStorage } from "@/infrastructure/storage/sqlite/sqlite-catalog-storage";
import { SqlitePreferenceDefinitionRepository } from "@/infrastructure/storage/sqlite/sqlite-preference-definition.repository";
import { SqliteAuditHistoryStorage } from "@/infrastructure/storage/sqlite/sqlite-audit-history-storage";
import { SqlitePreferenceAuditService } from "@/infrastructure/storage/sqlite/sqlite-preference-audit.service";
import { seedCatalog } from "@/domains/shared/storage/seed-catalog";
import { StorageUnavailableError } from "@/domains/shared/storage/storage-errors";

describe("real local repository compatibility", () => {
  let parent: string,
    db: SqliteDatabase,
    users: SqliteUserRepository,
    owner: string;
  const inspect = (sql: string, values: any[] = []) => {
    const c = db.connect();
    try {
      return c.all(sql, values);
    } finally {
      c.close();
    }
  };
  beforeEach(async () => {
    parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-semantics-")),
    );
    db = SqliteDatabase.bootstrap({
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    });
    users = new SqliteUserRepository(db);
    owner = (await users.create({ email: "owner@example.test" })).userId;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(parent, { recursive: true, force: true });
  });
  it("preserves duplicate emails, truthy updates, Date values and external identity JSON/no-op behavior", async () => {
    const other = await users.create({ email: "owner@example.test" });
    expect(other.userId).not.toBe(owner);
    inspect("UPDATE users SET updated_at=1 WHERE user_id=?", [owner]);
    const unchanged = await users.update(owner, { email: "" });
    expect(unchanged.email).toBe("owner@example.test");
    expect(unchanged.updatedAt.getTime()).toBe(1);
    expect(unchanged.createdAt).toBeInstanceOf(Date);
    const external = new SqliteExternalIdentityRepository(db);
    const binding = await external.linkIdentityToUser(
      owner,
      "test",
      "issuer",
      "subject",
      { nested: { omitted: undefined, kept: true } },
    );
    expect(binding.metadata).toEqual({ nested: { kept: true } });
    inspect("UPDATE external_identities SET updated_at=1 WHERE id=?", [
      binding.id,
    ]);
    expect((await external.update(binding.id, {})).updatedAt.getTime()).toBe(1);
    expect(
      (await external.update(binding.id, { metadata: null })).metadata,
    ).toBeNull();
    expect(
      inspect(
        "SELECT metadata IS NULL sql_null,json_type(metadata) kind FROM external_identities WHERE id=?",
        [binding.id],
      ),
    ).toEqual([{ sql_null: 0, kind: "null" }]);
    expect(
      (await external.findByProviderAndUserId("test", "issuer", "subject"))
        .userId,
    ).toBe(owner);
    expect(
      await external.findByProviderAndUserId("test", "other", "subject"),
    ).toBeNull();
    await users.delete(owner);
    expect(await external.findByUserId(owner)).toEqual([]);
    expect(await users.count()).toBe(1);
  });
  it("retains location truthy omission and address-only upsert", async () => {
    const locations = new SqliteLocationRepository(db);
    const row = await locations.create(owner, {
      type: "HOME",
      label: "Home",
      address: "old",
    });
    inspect("UPDATE locations SET updated_at=1 WHERE location_id=?", [
      row.locationId,
    ]);
    expect(
      (
        await locations.update(row.locationId, { label: "", address: "" })
      ).updatedAt.getTime(),
    ).toBe(1);
    const changed = await locations.upsert(owner, {
      type: "HOME",
      label: "Home",
      address: "new",
    });
    expect(changed.locationId).toBe(row.locationId);
    expect(changed.address).toBe("new");
    expect(await locations.findByUserIdAndType(owner, "WORK")).toEqual([]);
    expect(await locations.count(owner)).toBe(1);
  });
  it("preserves grant declaration ordering, exact targets and original timestamps on upsert", async () => {
    const grants = new SqlitePermissionGrantRepository(db);
    for (const action of ["DEFINE", "WRITE", "SUGGEST", "READ"] as const)
      await grants.upsert(owner, "client", "*", action, "ALLOW");
    expect(
      (await grants.findByUserAndClient(owner, "client")).map(
        (row) => row.action,
      ),
    ).toEqual(["READ", "SUGGEST", "WRITE", "DEFINE"]);
    await grants.upsert(owner, "client", "food.*", "READ", "ALLOW");
    const exact = await grants.upsert(
      owner,
      "client",
      "food.diet",
      "READ",
      "DENY",
    );
    inspect(
      "UPDATE permission_grants SET created_at=1,updated_at=1 WHERE id=?",
      [exact.id],
    );
    const updated = await grants.upsert(
      owner,
      "client",
      "food.diet",
      "READ",
      "ALLOW",
    );
    expect(updated.id).toBe(exact.id);
    expect(updated.createdAt.getTime()).toBe(1);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(1);
    expect(
      (
        await grants.findMatchingGrants(owner, "client", "READ", [
          "*",
          "food.*",
          "food.diet",
        ])
      ).map((row) => row.target),
    ).toEqual(["food.diet", "food.*", "*"]);
    expect(
      await grants.findMatchingGrants(owner, "client", "READ", ["food.%"]),
    ).toEqual([]);
    await expect(
      grants.remove(owner, "client", "absent", "READ"),
    ).resolves.toBeUndefined();
  });
  it("initializes only catalog, preserves IDs, personal precedence/archives/stale rows and per-entry completion", async () => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const definitions = new SqlitePreferenceDefinitionRepository(db),
      catalog = new SqliteCatalogStorage(db);
    const data = { description: "test", valueType: "STRING", scope: "GLOBAL" };
    const personal = await definitions.create({
      ...data,
      slug: "test.first",
      ownerUserId: owner,
    });
    const archived = await definitions.create({ ...data, slug: "test.first" });
    await definitions.archive(archived.id);
    const stale = await definitions.create({ ...data, slug: "test.stale" });
    const input = {
      "test.first": {
        description: "catalog",
        category: "test",
        valueType: "string" as const,
        scope: "global" as const,
      },
      "test.second": {
        description: "second",
        category: "test",
        valueType: "string" as const,
        scope: "global" as const,
      },
    };
    const create = catalog.createGlobal.bind(catalog);
    const failure = jest
      .spyOn(catalog, "createGlobal")
      .mockImplementation((slug, value) =>
        slug === "test.second"
          ? Promise.reject(new Error("second entry"))
          : create(slug, value),
      );
    await expect(seedCatalog(catalog, input)).rejects.toThrow("second entry");
    const first = await catalog.findActiveGlobal("test.first");
    expect(first).not.toBeNull();
    expect(await catalog.findActiveGlobal("test.second")).toBeNull();
    failure.mockRestore();
    await seedCatalog(catalog, input);
    await seedCatalog(catalog, input);
    expect((await catalog.findActiveGlobal("test.first")).id).toBe(first.id);
    expect(
      (await definitions.getDefinitionBySlug("test.first", owner)).id,
    ).toBe(personal.id);
    expect(
      (await definitions.getDefinitionById(archived.id)).archivedAt,
    ).toBeInstanceOf(Date);
    expect(await definitions.getDefinitionById(stale.id)).not.toBeNull();
    expect(await users.count()).toBe(1);
    expect(inspect("SELECT count(*) n FROM external_identities")[0].n).toBe(0);
    expect(
      inspect(
        "SELECT json_type(options) kind FROM preference_definitions WHERE id=?",
        [first.id],
      )[0].kind,
    ).toBe("null");
  });
  it("applies reference case/wildcard/escape/codepoint/long-prefix semantics inside SQL before LIMIT", async () => {
    const audit = new SqlitePreferenceAuditService(db),
      history = new SqliteAuditHistoryStorage(db);
    for (const slug of [
      "Case.alpha",
      "case.beta",
      "wild%literal",
      "wildXliteral",
      "wild_literal",
      "slash\\literal",
      "*?[literal",
      "astral😀x",
    ])
      await audit.record({
        userId: owner,
        subjectSlug: slug,
        targetType: "PREFERENCE",
        targetId: "target",
        eventType: "PREFERENCE_SET",
        actorType: "USER",
        origin: "GRAPHQL",
        correlationId: "reference",
      });
    const find = async (prefix: string, limit = 100) =>
      (await history.findPage(owner, { subjectSlug: prefix }, null, limit))
        .map((row) => row.subjectSlug)
        .sort();
    expect(await find("Case")).toEqual(["Case.alpha"]);
    expect(await find("wild%")).toEqual([
      "wild%literal",
      "wildXliteral",
      "wild_literal",
    ]);
    expect(await find("wild\\%")).toEqual(["wild%literal"]);
    expect(await find("wild\\_")).toEqual(["wild_literal"]);
    expect(await find("slash\\\\")).toEqual(["slash\\literal"]);
    expect(await find("*?[")).toEqual(["*?[literal"]);
    expect(await find("astral_x")).toEqual(["astral😀x"]);
    expect(await find("x".repeat(60001))).toEqual([]);
    expect(await find("%".repeat(60001))).toHaveLength(8);
    await expect(find("bad\0text")).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    expect(await find("Case", 1)).toEqual(["Case.alpha"]);
  });
});
