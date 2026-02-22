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
import { resetDb, disconnectPrisma, seedPreferenceDefinitions } from './test-db';

// Increase timeout for database operations
jest.setTimeout(60000);

// Reset database before each test for clean state, then seed preference definitions
// (required by FK constraint before any preference data can be created)
beforeEach(async () => {
  await resetDb();
  await seedPreferenceDefinitions();
});

// Disconnect the shared Prisma client after all tests complete
afterAll(async () => {
  await disconnectPrisma();
});
