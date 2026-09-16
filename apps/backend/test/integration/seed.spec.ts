/**
 * Seed Integration Tests
 *
 * Verifies that seedPreferenceDefinitions() from the actual prisma/seed.ts
 * (not the test-db helper) creates the correct definitions.
 *
 * The global beforeEach (jest.after-env.ts) resets the DB and seeds via test-db.ts
 * before each test. Each test here resets again and calls the real seed function
 * so we're specifically exercising seed.ts, not the test-db copy.
 */
import { seedPreferenceDefinitions } from "../../prisma/seed";
import { PREFERENCE_CATALOG } from "../../src/config/preferences.catalog";
import { getPrismaClient, resetDb } from "../setup/test-db";
import { PrismaClient } from "../../src/infrastructure/prisma/generated-client";
import catalogBaseline from "../contracts/fixtures/preference-catalog.v1.json";
import { PreferenceDefinitionRepository } from "../../src/modules/preferences/preference-definition/preference-definition.repository";

const CATALOG_COUNT = Object.keys(PREFERENCE_CATALOG).length;

describe("seed: seedPreferenceDefinitions()", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = getPrismaClient() as unknown as PrismaClient;
  });

  beforeEach(async () => {
    // Global beforeEach already ran resetDb + seedPreferenceDefinitions (test-db version).
    // Reset again and run the real seed function so we specifically test seed.ts.
    await resetDb();
    await seedPreferenceDefinitions();
  });

  it("seeds the correct number of definitions", async () => {
    const defs = await prisma.preferenceDefinition.findMany();
    expect(defs).toHaveLength(CATALOG_COUNT);
  });

  it("matches all catalog semantic fields exactly", async () => {
    const defs = await prisma.preferenceDefinition.findMany({
      orderBy: { slug: "asc" },
    });
    expect(
      defs.map((def) => ({
        slug: def.slug,
        valueType: def.valueType.toLowerCase(),
        scope: def.scope.toLowerCase(),
        isSensitive: def.isSensitive,
        options: def.options,
      })),
    ).toEqual(
      Object.entries(catalogBaseline.semantic).map(([slug, def]) => ({
        slug,
        valueType: def.valueType,
        scope: def.scope,
        isSensitive: def.isSensitive,
        options: def.options,
      })),
    );
  });

  it("sets namespace=GLOBAL, isCore=true, ownerUserId=null on all definitions", async () => {
    const defs = await prisma.preferenceDefinition.findMany();
    for (const def of defs) {
      expect(def.namespace).toBe("GLOBAL");
      expect(def.isCore).toBe(true);
      expect(def.ownerUserId).toBeNull();
    }
  });

  it("seeds exactly the slugs in the catalog", async () => {
    const defs = await prisma.preferenceDefinition.findMany();
    const seededSlugs = defs.map((d) => d.slug).sort();
    const catalogSlugs = Object.keys(PREFERENCE_CATALOG).sort();
    expect(seededSlugs).toEqual(catalogSlugs);
  });

  it("is idempotent — running twice does not create duplicates or throw", async () => {
    const before = await prisma.preferenceDefinition.findMany({
      where: { namespace: "GLOBAL", archivedAt: null },
      orderBy: { slug: "asc" },
      select: { id: true, slug: true },
    });
    await seedPreferenceDefinitions();
    const defs = await prisma.preferenceDefinition.findMany({
      where: { namespace: "GLOBAL", archivedAt: null },
      orderBy: { slug: "asc" },
      select: { id: true, slug: true },
    });
    expect(defs).toHaveLength(CATALOG_COUNT);
    expect(defs).toEqual(before);
  });

  it("updates changed catalog attributes while preserving the active definition id", async () => {
    const original = await prisma.preferenceDefinition.findFirstOrThrow({
      where: { namespace: "GLOBAL", slug: "profile.email", archivedAt: null },
    });
    await prisma.preferenceDefinition.update({
      where: { id: original.id },
      data: {
        displayName: "Wrong",
        description: "Wrong",
        valueType: "ARRAY",
        scope: "LOCATION",
        options: ["wrong"],
        isSensitive: false,
        isCore: false,
      },
    });

    await seedPreferenceDefinitions();
    const repaired = await prisma.preferenceDefinition.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(repaired).toMatchObject({
      id: original.id,
      displayName: "Contact Email",
      description:
        "The user's preferred contact email for forms and communication.",
      valueType: "STRING",
      scope: "GLOBAL",
      options: null,
      isSensitive: true,
      isCore: true,
    });
  });

  it("creates a global definition beside a colliding user definition and keeps user precedence", async () => {
    await resetDb();
    const user = await prisma.user.create({
      data: { email: "collision@example.com" },
    });
    const userDefinition = await prisma.preferenceDefinition.create({
      data: {
        namespace: `USER:${user.userId}`,
        slug: "profile.full_name",
        ownerUserId: user.userId,
        description: "Personal override",
        valueType: "STRING",
        scope: "GLOBAL",
      },
    });
    const warning = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await seedPreferenceDefinitions();
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'GLOBAL slug "profile.full_name" collides with 1',
        ),
      );
    } finally {
      warning.mockRestore();
    }
    const repository = new PreferenceDefinitionRepository(prisma as never);
    expect(
      await repository.getDefinitionBySlug("profile.full_name", user.userId),
    ).toMatchObject({ id: userDefinition.id });
    expect(
      await prisma.preferenceDefinition.findFirst({
        where: {
          namespace: "GLOBAL",
          slug: "profile.full_name",
          archivedAt: null,
        },
      }),
    ).not.toBeNull();
  });

  it("retains an archived global and creates a distinct active replacement", async () => {
    const original = await prisma.preferenceDefinition.findFirstOrThrow({
      where: {
        namespace: "GLOBAL",
        slug: "system.response_length",
        archivedAt: null,
      },
    });
    await prisma.preferenceDefinition.update({
      where: { id: original.id },
      data: { archivedAt: new Date() },
    });
    await seedPreferenceDefinitions();
    const all = await prisma.preferenceDefinition.findMany({
      where: { namespace: "GLOBAL", slug: "system.response_length" },
      orderBy: { createdAt: "asc" },
    });
    expect(all).toHaveLength(2);
    expect(all.find((item) => item.archivedAt)?.id).toBe(original.id);
    expect(all.find((item) => !item.archivedAt)?.id).not.toBe(original.id);
  });

  it("retains stale active global definitions that are absent from the catalog", async () => {
    const stale = await prisma.preferenceDefinition.create({
      data: {
        namespace: "GLOBAL",
        slug: "legacy.stale",
        description: "Not in catalog",
        valueType: "STRING",
        scope: "GLOBAL",
      },
    });
    await seedPreferenceDefinitions();
    expect(
      await prisma.preferenceDefinition.findUnique({ where: { id: stale.id } }),
    ).toMatchObject({ archivedAt: null });
  });

  it("is non-transactional across definitions when a later catalog entry fails", async () => {
    await resetDb();
    const partialCatalog = {
      "baseline.first": {
        category: "baseline",
        description: "first",
        valueType: "string",
        scope: "global",
      },
      "baseline.invalid": {
        category: "baseline",
        description: "invalid",
        valueType: "not-a-value-type",
        scope: "global",
      },
    };
    await expect(
      seedPreferenceDefinitions(prisma, partialCatalog as never),
    ).rejects.toThrow();
    expect(
      await prisma.preferenceDefinition.findFirst({
        where: { namespace: "GLOBAL", slug: "baseline.first" },
      }),
    ).not.toBeNull();
  });

  it("the definition helper alone does not create sample users", async () => {
    await resetDb();
    await seedPreferenceDefinitions(prisma);
    expect(await prisma.user.count()).toBe(0);
  });
});
