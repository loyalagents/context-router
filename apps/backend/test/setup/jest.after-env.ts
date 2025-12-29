/**
 * Jest setupFilesAfterEnv - runs after Jest is installed but before tests run
 *
 * This file sets up:
 * - Global beforeEach hook to reset the database
 * - Global afterAll hook to disconnect Prisma
 *
 * Note: Individual tests using createTestApp() should call app.close() in their
 * own afterAll hook. This file handles the shared Prisma client cleanup.
 */
import { resetDb, disconnectPrisma } from './test-db';

// Increase timeout for database operations
jest.setTimeout(60000);

// Reset database before each test for clean state
beforeEach(async () => {
  await resetDb();
});

// Disconnect the shared Prisma client after all tests complete
afterAll(async () => {
  await disconnectPrisma();
});
