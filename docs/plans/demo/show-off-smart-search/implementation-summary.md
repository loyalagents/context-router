# Show Off Smart Search UI Implementation Summary

- Status: implemented
- Date: 2026-05-01

## What Changed

- Added a first-party GraphQL smart-search query:
  - `smartSearchPreferences(input: SmartPreferenceSearchInput!): SmartPreferenceSearchResult!`
  - The resolver reuses `PreferenceSearchWorkflow` with the authenticated dashboard user.
  - The GraphQL path uses a pass-through slug filter, so it does not apply MCP client permission grants.
- Added typed GraphQL input/result models for smart search.
- Registered the smart-search resolver through `WorkflowsModule` and imported that module into `AppModule`.
- Updated the generated backend GraphQL schema.
- Added `/dashboard/search-lab`.
  - Exact search filters the loaded catalog/preferences in React by slug prefix, category, or description.
  - Smart search calls the new GraphQL query and displays `queryInterpretation`, matched definitions, active values, and suggested values.
  - The page includes example scenarios, `Run Both`, `includeSuggestions`, and an optional location ID for smart search.
- Added a `Search Lab` link from `/dashboard`.

## Important Tradeoffs

- The dashboard does not call MCP directly. MCP transport, MCP permission grants, and MCP access logs remain separate from this first-party UI.
- Exact search is client-side for this pass. It uses the globally loaded dashboard snapshot rather than adding a new backend exact-search API.
- No new demo seed data or apparel-specific definitions were added.

## Verification

- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/smart-search-graphql.e2e-spec.ts test/e2e/workflows.e2e-spec.ts`
- `pnpm --filter backend exec jest --selectProjects unit --runInBand src/mcp/tools/smart-search.tool.spec.ts src/mcp/tools/preference-search.tool.spec.ts src/modules/workflows/preferences/preference-search/preference-search.workflow.spec.ts`
- `pnpm --filter backend build`
- `pnpm --filter web codegen`
- `pnpm --filter web build`

The web build passed with existing Auth0 environment warnings and the existing Auth0 Edge-runtime warning.
