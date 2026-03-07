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
    await seedPreferenceDefinitions();
    const defs = await prisma.preferenceDefinition.findMany({
      where: { namespace: "GLOBAL", archivedAt: null },
    });
    expect(defs).toHaveLength(CATALOG_COUNT);
  });
});
