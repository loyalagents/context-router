import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { SqliteStorageUnitOfWork } from "@/infrastructure/storage/sqlite/sqlite-unit-of-work";
import { SqliteIdentityStorage } from "@/infrastructure/storage/sqlite/sqlite-identity-storage";
import { SqliteUserRepository } from "@/infrastructure/storage/sqlite/sqlite-user.repository";
import { SqliteCatalogStorage } from "@/infrastructure/storage/sqlite/sqlite-catalog-storage";
import { seedCatalog } from "@/domains/shared/storage/seed-catalog";
import { VerifiedHumanIdentityResolver } from "@/modules/auth/verified-human-identity.resolver";
import { AuthService } from "@/modules/auth/auth.service";
import { UserService } from "@/modules/user/user.service";
import {
  createM2MCompatibilityPrincipalId,
  createM2MCompatibilityEmail,
  createSyntheticPrincipalEmail,
} from "@/modules/auth/principal-identity";
import { fixtureRows } from "./fixture-rows";

describe("actual SQLite verified human and compatibility identity use cases", () => {
  let root: string,
    db: SqliteDatabase,
    rows: ReturnType<typeof fixtureRows>,
    uow: SqliteStorageUnitOfWork,
    identity: SqliteIdentityStorage,
    resolver: VerifiedHumanIdentityResolver,
    auth: AuthService;
  const key = {
    provider: "auth0",
    issuer: "https://issuer.example.test/",
    subject: "human",
  };
  const m2m = { ...key, subject: "client@clients" };
  beforeEach(async () => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-identity-usecase-")),
    );
    db = SqliteDatabase.bootstrap({
      databaseRoot: path.join(root, "data"),
      identityRoot: path.join(root, "identity"),
    });
    rows = fixtureRows(db);
    uow = new SqliteStorageUnitOfWork(db);
    identity = new SqliteIdentityStorage(db);
    resolver = new VerifiedHumanIdentityResolver(uow, identity);
    auth = new AuthService(new UserService(new SqliteUserRepository(db)), uow);
    await seedCatalog(new SqliteCatalogStorage(db), undefined, {
      log() {},
      warn() {},
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const profile = async (userId: string) => {
    const c = db.connect();
    try {
      return c
        .all(
          "SELECT d.slug,p.value FROM user_preferences p JOIN preference_definitions d ON d.id=p.definition_id WHERE p.user_id=? ORDER BY d.slug",
          [userId],
        )
        .map((row) => ({
          slug: row.slug,
          value: JSON.parse(String(row.value)),
        }));
    } finally {
      c.close();
    }
  };
  it("converges twelve real resolver calls to one exact tuple without email linking", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        resolver.resolve({
          key,
          profileHints: { verifiedEmail: "equal@example.test" },
        }),
      ),
    );
    expect(new Set(results.map((user) => user.userId)).size).toBe(1);
    expect(await rows.user.count()).toBe(1);
    expect(await rows.externalIdentity.count()).toBe(1);
    const distinct = await Promise.all([
      resolver.resolve({
        key: { ...key, issuer: "https://other.example.test/" },
        profileHints: { verifiedEmail: "equal@example.test" },
      }),
      resolver.resolve({
        key: { ...key, provider: "oidc" },
        profileHints: { verifiedEmail: "equal@example.test" },
      }),
      resolver.resolve({
        key: { ...key, subject: "different" },
        profileHints: { verifiedEmail: "equal@example.test" },
      }),
    ]);
    expect(
      new Set([results[0], ...distinct].map((user) => user.userId)).size,
    ).toBe(4);
    expect(await rows.user.count()).toBe(4);
    expect(await rows.externalIdentity.count()).toBe(4);
  });
  it("rolls back a witnessed principal insert on a real binding failure", async () => {
    let witnessed = false;
    const connect = db.connect.bind(db);
    const spy = jest.spyOn(db, "connect").mockImplementation(() => {
      const c = connect();
      c.exec(
        "CREATE TEMP TRIGGER fail_binding BEFORE INSERT ON external_identities BEGIN SELECT RAISE(ABORT,'private-binding-canary'); END",
      );
      const get = c.get.bind(c);
      c.get = (sql, params) => {
        if (sql.startsWith("INSERT INTO external_identities")) {
          expect(c.get("SELECT count(*) n FROM users")!.n).toBe(1);
          witnessed = true;
        }
        return get(sql, params);
      };
      return c;
    });
    await expect(resolver.resolve({ key })).rejects.toThrow(
      "Human identity resolution failed",
    );
    spy.mockRestore();
    expect(witnessed).toBe(true);
    expect(await rows.user.count()).toBe(0);
    expect(await rows.externalIdentity.count()).toBe(0);
  });
  it("keeps application-owned five attempts for real native unique conflicts and only then reads the exact winner", async () => {
    await rows.user.create({
      data: { userId: "existing", email: "existing@example.test" },
    });
    await rows.externalIdentity.create({
      data: {
        userId: "existing",
        provider: "auth0",
        issuer: key.issuer,
        providerUserId: "occupied",
      },
    });
    let writes = 0;
    const connect = db.connect.bind(db),
      attempts = jest.spyOn(uow, "serializable"),
      lookup = jest.spyOn(identity, "findExact");
    const spy = jest.spyOn(db, "connect").mockImplementation(() => {
      const c = connect(),
        get = c.get.bind(c);
      c.get = (sql, params) => {
        if (sql.startsWith("INSERT INTO external_identities")) {
          expect(c.get("SELECT count(*) n FROM users")!.n).toBe(2);
          writes++;
          const values = [...params!];
          values[4] = "occupied";
          return get(sql, values);
        }
        return get(sql, params);
      };
      return c;
    });
    await expect(resolver.resolve({ key })).rejects.toThrow(
      "Human identity resolution conflict",
    );
    spy.mockRestore();
    expect(attempts).toHaveBeenCalledTimes(5);
    expect(writes).toBe(5);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await rows.user.count()).toBe(1);
    expect(await rows.externalIdentity.count()).toBe(1);
  });
  it("makes five fresh attempts for native lock contention without a final unique lookup", async () => {
    const held = db.connect();
    held.exec("BEGIN IMMEDIATE");
    const attempts = jest.spyOn(uow, "serializable"),
      lookup = jest.spyOn(identity, "findExact");
    try {
      await expect(resolver.resolve({ key })).rejects.toThrow(
        "Human identity resolution conflict",
      );
      expect(attempts).toHaveBeenCalledTimes(5);
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      held.exec("ROLLBACK");
      held.close();
    }
    expect(await rows.user.count()).toBe(0);
  });
  it("omits malformed hints independently and starts profile writes only after acknowledged principal and binding commit", async () => {
    let witnessed = false;
    const original = identity.findInitialProfileDefinitions.bind(identity);
    jest
      .spyOn(identity, "findInitialProfileDefinitions")
      .mockImplementation(async (slugs) => {
        const c = db.connect();
        try {
          c.exec("BEGIN IMMEDIATE");
          expect(c.get("SELECT count(*) n FROM users")!.n).toBe(1);
          expect(c.get("SELECT count(*) n FROM external_identities")!.n).toBe(
            1,
          );
          c.exec("ROLLBACK");
          witnessed = true;
        } finally {
          c.close();
        }
        return original(slugs);
      });
    const user = await resolver.resolve({
      key,
      profileHints: {
        verifiedEmail: "bad email",
        displayName: "\ud800",
        givenName: "Ada",
        familyName: "\u0000private",
      },
    });
    expect(witnessed).toBe(true);
    expect(user.email).toBe(createSyntheticPrincipalEmail(user.userId));
    expect(await profile(user.userId)).toEqual([
      { slug: "profile.first_name", value: "Ada" },
    ]);
    const before = await rows.user.findMany(),
      memory = await rows.preference.findMany();
    const seed = jest.spyOn(identity, "createInitialProfileValue");
    expect(
      await resolver.resolve({
        key,
        profileHints: {
          verifiedEmail: "new@example.test",
          givenName: "Changed",
          familyName: "New",
        },
      }),
    ).toEqual(user);
    expect(seed).not.toHaveBeenCalled();
    expect(await rows.user.findMany()).toEqual(before);
    expect(await rows.preference.findMany()).toEqual(memory);
  });
  it("returns committed identity after a real profile storage failure with a fixed warning", async () => {
    let witnessed = false;
    const warn = jest
        .spyOn((resolver as any).logger, "warn")
        .mockImplementation(() => {}),
      connect = db.connect.bind(db);
    const spy = jest.spyOn(db, "connect").mockImplementation(() => {
      const c = connect();
      c.exec(
        "CREATE TEMP TRIGGER fail_profile BEFORE INSERT ON user_preferences BEGIN SELECT RAISE(ABORT,'private-profile-canary'); END",
      );
      const get = c.get.bind(c);
      c.get = (sql, params) => {
        if (sql.startsWith("INSERT INTO user_preferences")) witnessed = true;
        return get(sql, params);
      };
      return c;
    });
    const user = await resolver.resolve({
      key,
      profileHints: { verifiedEmail: "valid@example.test", givenName: "Ada" },
    });
    spy.mockRestore();
    expect(witnessed).toBe(true);
    expect(user.email).toBe("valid@example.test");
    expect(warn.mock.calls).toEqual([
      ["Could not seed initial profile preferences"],
    ]);
    expect(await rows.user.count()).toBe(1);
    expect(await rows.externalIdentity.count()).toBe(1);
    expect(await rows.preference.count()).toBe(0);
  });
  it("converges twelve M2M calls, separates issuers, and never creates human bindings", async () => {
    const users = await Promise.all(
      Array.from({ length: 12 }, () => auth.findOrCreateM2MUser(m2m)),
    );
    expect(new Set(users.map((user) => user.userId))).toEqual(
      new Set([createM2MCompatibilityPrincipalId(m2m)]),
    );
    expect(users[0].email).toBe(createM2MCompatibilityEmail(m2m));
    expect(await rows.externalIdentity.count()).toBe(0);
    const other = await auth.findOrCreateM2MUser({
      ...m2m,
      issuer: "https://other.example.test/",
    });
    expect(other.userId).not.toBe(users[0].userId);
    expect(await rows.user.count()).toBe(2);
  });
  it.each(["email", "binding"])(
    "preserves an incompatible M2M %s principal without repurposing it",
    async (kind) => {
      const user = await auth.findOrCreateM2MUser(m2m);
      if (kind === "email")
        await rows.user.update({
          where: { userId: user.userId },
          data: { email: "human@example.test" },
        });
      else
        await rows.externalIdentity.create({
          data: {
            userId: user.userId,
            provider: "auth0",
            issuer: key.issuer,
            providerUserId: "human",
          },
        });
      const before = await Promise.all([
        rows.user.findMany(),
        rows.externalIdentity.findMany(),
      ]);
      await expect(auth.findOrCreateM2MUser(m2m)).rejects.toThrow(
        "Hosted M2M compatibility principal conflict",
      );
      expect(
        await Promise.all([
          rows.user.findMany(),
          rows.externalIdentity.findMany(),
        ]),
      ).toEqual(before);
    },
  );
});
