import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { PREFERENCE_CATALOG } from "../../src/config/preferences-catalog-data";
import { getPrismaClient, resetDb } from "../setup/test-db";

const execute = promisify(execFile);
const db = getPrismaClient();
const seed = () =>
  execute(process.execPath, ["-r", "ts-node/register", "prisma/seed.ts"], {
    cwd: resolve(__dirname, "../.."),
    env: { ...process.env },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
const catalog = () =>
  db.preferenceDefinition.findMany({ orderBy: { slug: "asc" } });

describe("production seed require.main entrypoint", () => {
  it("creates exactly the source catalog and zero sample users on two actual executions", async () => {
    // The integration setup seeds definitions automatically; remove them to test the executable itself.
    await resetDb();
    await seed();
    expect(await db.user.count()).toBe(0);
    const first = await catalog();
    expect(
      first.map(({ id, createdAt, updatedAt, ...fields }) => fields),
    ).toEqual(
      Object.entries(PREFERENCE_CATALOG)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([slug, definition]) => ({
          slug,
          namespace: "GLOBAL",
          ownerUserId: null,
          archivedAt: null,
          displayName: definition.displayName ?? null,
          description: definition.description,
          valueType: definition.valueType.toUpperCase(),
          scope: definition.scope.toUpperCase(),
          options: definition.options ?? null,
          isSensitive: definition.isSensitive ?? false,
          isCore: true,
        })),
    );
    await seed();
    expect(await db.user.count()).toBe(0);
    expect((await catalog()).map(({ id, slug }) => ({ id, slug }))).toEqual(
      first.map(({ id, slug }) => ({ id, slug })),
    );
  });

  it("preserves pre-existing principal and binding rows byte-for-byte as data", async () => {
    await resetDb();
    const user = await db.user.create({
      data: { email: "existing@principal.invalid" },
    });
    const identity = await db.externalIdentity.create({
      data: {
        userId: user.userId,
        provider: "contract",
        issuer: "https://issuer.example.test/",
        providerUserId: "subject",
        metadata: { retained: true },
      },
    });
    await seed();
    await seed();
    expect(await db.user.findMany()).toEqual([user]);
    expect(await db.externalIdentity.findMany()).toEqual([identity]);
  });
});
