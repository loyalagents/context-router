import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { LocalIdentityFileStore } from "@/modules/auth/local-identity-filesystem";
import { LocalIdentityStateService } from "@/modules/auth/local-identity-state.service";

describe("managed namespace rejects unadmitted source/manual access", () => {
  let parent: string;
  let envelope: string;
  let store: string;
  let pair: { databaseRoot: string; identityRoot: string };

  beforeEach(() => {
    parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "managed-admission-")));
    fs.chmodSync(parent, 0o700);
    envelope = path.join(parent, "managed-v1");
    store = path.join(envelope, "stores", "candidate");
    fs.mkdirSync(store, { recursive: true, mode: 0o700 });
    pair = { databaseRoot: path.join(store, "data"), identityRoot: path.join(store, "identity") };
  });
  afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

  it.each(["missing", "forged"])("refuses bootstrap with %s metadata before creating a database", (metadata) => {
    if (metadata === "forged") {
      fs.writeFileSync(path.join(envelope, "installation.json"), JSON.stringify({ selectedStore: "candidate" }), { mode: 0o600 });
      fs.writeFileSync(path.join(envelope, "owner.json"), JSON.stringify({ state: "active", authorized: true }), { mode: 0o600 });
    }
    expect(() => SqliteDatabase.bootstrap(pair)).toThrow();
    expect(fs.existsSync(pair.databaseRoot)).toBe(false);
    expect(fs.existsSync(pair.identityRoot)).toBe(false);
  });

  it("rejects a managed identity paired with an unmanaged database before mutation", () => {
    const mixed = { ...pair, databaseRoot: path.join(parent, "outside-data") };
    expect(() => SqliteDatabase.bootstrap(mixed)).toThrow();
    expect(fs.existsSync(mixed.databaseRoot)).toBe(false);
  });

  it("does not treat an empty managed root as named bootstrap recovery authority", () => {
    expect(() => SqliteDatabase.recoverBootstrap(pair)).toThrow();
    expect(fs.existsSync(pair.databaseRoot)).toBe(false);
  });

  it("refuses opening an otherwise valid existing database under the managed namespace", () => {
    const outside = { databaseRoot: path.join(parent, "outside-data"), identityRoot: path.join(parent, "outside-identity") };
    SqliteDatabase.bootstrap(outside);
    fs.renameSync(outside.databaseRoot, pair.databaseRoot);
    const file = path.join(pair.databaseRoot, "database.sqlite");
    const before = fs.readFileSync(file);
    expect(() => SqliteDatabase.open(pair)).toThrow();
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it("refuses identity preparation before creating the private root", async () => {
    const identity = new LocalIdentityFileStore({ stateRoot: pair.identityRoot, databaseTargetId: "test-target" });
    await expect(identity.prepareRoot({ create: true })).rejects.toThrow();
    expect(fs.existsSync(pair.identityRoot)).toBe(false);
  });

  it("preserves unmanaged source/manual roots including a similar unreserved name", () => {
    const outside = path.join(parent, "managed-v10");
    fs.mkdirSync(outside, { mode: 0o700 });
    const options = { databaseRoot: path.join(outside, "data"), identityRoot: path.join(outside, "identity") };
    const database = SqliteDatabase.bootstrap(options);
    expect(SqliteDatabase.open(options).targetId).toBe(database.targetId);
  });

  it("rejects direct identity administration before acquiring a database session", async () => {
    const acquire = jest.fn().mockRejectedValue(new Error("unexpected database access"));
    const service = new LocalIdentityStateService({
      fileStore: new LocalIdentityFileStore({ stateRoot: pair.identityRoot, databaseTargetId: "test-target" }),
      repository: { acquire },
    });
    await expect(service.initialize()).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
    expect(fs.existsSync(pair.identityRoot)).toBe(false);
  });
});
