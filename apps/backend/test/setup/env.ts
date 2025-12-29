/**
 * Jest setupFiles - loads .env.test before any imports
 *
 * This file runs via Jest's `setupFiles` option, which executes
 * BEFORE the test framework is installed. This ensures environment
 * variables are set before any modules are imported.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../../.env.test');
dotenv.config({ path: envPath });

// Verify critical env vars are loaded
if (process.env.NODE_ENV !== 'test') {
  throw new Error(
    `Expected NODE_ENV=test but got NODE_ENV=${process.env.NODE_ENV}. ` +
      `Make sure .env.test exists at ${envPath}`,
  );
}
