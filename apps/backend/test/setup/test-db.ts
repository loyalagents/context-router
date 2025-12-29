/**
 * Test Database Utilities
 *
 * Provides helpers for managing the test database state:
 * - getPrismaClient(): Singleton PrismaClient for tests
 * - resetDb(): Truncates all tables (except migrations) for clean state
 */
import { PrismaClient } from '@prisma/client';

let prismaClient: PrismaClient | null = null;

/**
 * Get or create a singleton PrismaClient for tests.
 * Uses the DATABASE_URL from .env.test (loaded via setupFiles).
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
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
  const tableNames = tables.map((t) => `"${t.tablename}"`).join(', ');

  await client.$executeRawUnsafe(`TRUNCATE ${tableNames} CASCADE`);
}
