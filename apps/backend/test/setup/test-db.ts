/**
 * Test Database Utilities
 *
 * Provides helpers for managing the test database state:
 * - getPrismaClient(): Singleton PrismaClient for tests
 * - resetDb(): Truncates all tables (except migrations) for clean state
 * - seedPreferenceDefinitions(): Seeds preference definitions (required by FK before any preference data)
 */
import {
  PrismaClient,
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";
import {
  PREFERENCE_CATALOG,
  PreferenceDefinition,
} from "../../src/config/preferences.catalog";
import { buildPrismaClientOptions } from "../../src/infrastructure/prisma/prisma-client-options";

let prismaClient: PrismaClient | null = null;

/**
 * Get or create a singleton PrismaClient for tests.
 * Uses the DATABASE_URL from .env.test (loaded via setupFiles).
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient(
      buildPrismaClientOptions({
        databaseUrl: process.env.DATABASE_URL,
      }),
    );
  }
  return prismaClient;
}

/**
 * Disconnect the singleton PrismaClient.
 * Call this in afterAll to clean up connections.
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

/**
 * Reset the database by truncating all tables except _prisma_migrations.
 * Uses TRUNCATE ... CASCADE to handle foreign key constraints.
 *
 * @param prisma - Optional PrismaClient instance (defaults to singleton)
 */
export async function resetDb(prisma?: PrismaClient): Promise<void> {
  const client = prisma || getPrismaClient();

  // Get all table names in the public schema, excluding Prisma's migration table
  const tables = await client.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename != '_prisma_migrations'
  `;

  if (tables.length === 0) {
    return;
  }

  // Build a single TRUNCATE statement for all tables
  const tableNames = tables.map((t) => `"${t.tablename}"`).join(", ");

  await client.$executeRawUnsafe(`TRUNCATE ${tableNames} CASCADE`);
}

const VALUE_TYPE_MAP: Record<string, PreferenceValueType> = {
  string: PreferenceValueType.STRING,
  boolean: PreferenceValueType.BOOLEAN,
  enum: PreferenceValueType.ENUM,
  array: PreferenceValueType.ARRAY,
};

const SCOPE_MAP: Record<string, PreferenceScope> = {
  global: PreferenceScope.GLOBAL,
  location: PreferenceScope.LOCATION,
};

/**
 * Seeds GLOBAL preference definitions into the test database.
 * Tests start with a clean DB (resetDb), so createMany is safe here.
 * Must be called after resetDb() and before any preference test data is created,
 * because user_preferences.definition_id has a FK to preference_definitions.id.
 */
export async function seedPreferenceDefinitions(
  prisma?: PrismaClient,
): Promise<void> {
  const client = prisma || getPrismaClient();

  const entries = Object.entries(PREFERENCE_CATALOG).map(([slug, def]) => {
    const catalogDef = def as PreferenceDefinition;
    return {
      namespace: "GLOBAL",
      slug,
      ownerUserId: null,
      displayName: catalogDef.displayName ?? null,
      description: catalogDef.description,
      valueType: VALUE_TYPE_MAP[catalogDef.valueType],
      scope: SCOPE_MAP[catalogDef.scope],
      options: catalogDef.options ?? undefined,
      isSensitive: catalogDef.isSensitive ?? false,
      isCore: true,
    };
  });

  await client.preferenceDefinition.createMany({
    data: entries,
    skipDuplicates: true,
  });
}
