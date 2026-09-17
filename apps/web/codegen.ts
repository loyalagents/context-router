import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  // Point to your GraphQL schema
  // Option 1: Use the tracked canonical schema fixture (NO Docker needed!)
  //          Runtime schema generation is in memory and must remain byte-identical
  //          Regenerate: pnpm --filter backend schema:generate
  //          Verify only: pnpm --filter backend schema:check
  schema: '../backend/src/schema.gql',

  // Option 2: Use the local running server (requires Docker/backend running)
  // schema: process.env.GRAPHQL_SCHEMA_URL || 'http://localhost:3000/graphql',

  // Option 3: Use a deployed backend
  // schema: 'https://your-production-api.com/graphql',

  // Scan all TypeScript/TSX files for GraphQL operations (queries/mutations)
  documents: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],

  generates: {
    // Output file for generated types
    './lib/generated/graphql.ts': {
      plugins: [
        'typescript',
        'typescript-operations',
      ],
      config: {
        // Generate types compatible with Apollo Client
        skipTypename: false,
        withHooks: false,
        withHOC: false,
        withComponent: false,
        // Make all fields optional by default (matches Apollo's behavior)
        avoidOptionals: false,
        // Use exact types
        exactOptionalPropertyTypes: true,
      },
    },
  },
};

export default config;
