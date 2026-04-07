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

// Deterministic MCP OAuth client IDs for tests.
// These are supplied in code so the auth policy work can be tested
// without requiring tracked env file changes first.
process.env.AUTH0_MCP_CLAUDE_CLIENT_ID ??= 'test-claude-client';
process.env.AUTH0_MCP_CODEX_CLIENT_ID ??= 'test-codex-client';
process.env.AUTH0_MCP_FALLBACK_CLIENT_ID ??= 'test-fallback-client';
process.env.AUTH0_MCP_PUBLIC_CLIENT_ID ??= process.env.AUTH0_MCP_FALLBACK_CLIENT_ID;

// Verify critical env vars are loaded
if (process.env.NODE_ENV !== 'test') {
  throw new Error(
    `Expected NODE_ENV=test but got NODE_ENV=${process.env.NODE_ENV}. ` +
      `Make sure .env.test exists at ${envPath}`,
  );
}
