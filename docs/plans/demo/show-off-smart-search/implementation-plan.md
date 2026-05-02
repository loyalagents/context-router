# Show Off Smart Search UI Plan

## Summary

Add a dedicated `/dashboard/search-lab` page that compares client-side literal preference search against backend smart search. The exact-search side filters already-loaded catalog/preferences in React. The smart-search side adds one authenticated GraphQL query that reuses the existing `PreferenceSearchWorkflow`.

This pass intentionally does not route the dashboard through MCP. MCP transport, MCP permission grants, JSON-RPC response formatting, and MCP access logs stay out of scope.

## Key Changes

- Add GraphQL smart search:
  - `smartSearchPreferences(input: SmartPreferenceSearchInput!): SmartPreferenceSearchResult!`
  - Input fields: `query: String!`, optional `locationId`, optional `includeSuggestions`.
  - Result fields: `matchedDefinitions`, `matchedActivePreferences`, `matchedSuggestedPreferences`, `queryInterpretation`.
  - Reuse `PreferenceSearchWorkflow` with the current dashboard user and a pass-through slug filter so the first-party dashboard sees the user's full visible schema.
  - Keep output typed with a small `MatchedPreferenceDefinition` object type, not raw JSON.

- Keep exact search client-side:
  - Load `preferenceCatalog`, `activePreferences`, and `suggestedPreferences` on the Search Lab page.
  - Filter definitions in React by normalized query:
    - `definition.slug.startsWith(query)`
    - category includes query
    - description includes query
  - Show matching active/suggested values by slug.
  - Mark matched definitions without stored values as `definition only`.
  - Empty exact query shows current active preferences.

- Add `/dashboard/search-lab`:
  - Server page follows the existing authenticated dashboard pattern and passes the backend access token to `SearchLabClient`.
  - Add a `Search Lab` link on `/dashboard`.
  - UI has `Exact Search` and `Smart Search` panels, independent run buttons, `Run Both`, `includeSuggestions`, optional `locationId`, loading/error states, result counts, and example chips.
  - Show smart-search `queryInterpretation` prominently.

## Implementation Checkpoints

1. Docs checkpoint:
   - Create `docs/plans/demo/show-off-smart-search/`.
   - Add this implementation plan before code changes.
2. Backend test-first checkpoint:
   - Add GraphQL e2e coverage for `smartSearchPreferences`.
   - Cover matched definitions with no value, active values, suggested values, empty AI result, hallucinated slug filtering, and authenticated-user scoping.
3. Backend implementation checkpoint:
   - Add smart-search GraphQL input/result models and resolver.
   - Register the resolver through `WorkflowsModule` and import it from `AppModule`.
   - Update generated GraphQL schema.
4. Web checkpoint:
   - Add Search Lab server/client page.
   - Add dashboard navigation link.
   - Run GraphQL codegen and web build.
5. Closure docs checkpoint:
   - Add `implementation-summary.md`.
   - Update `docs/plans/demo/TODO.md`.

## Test Plan

- Backend:
  - New GraphQL e2e tests for smart search.
  - Existing MCP smart-search workflow/tool tests remain green.
  - Generated schema includes the new query and types.
- Web:
  - `pnpm --filter web codegen`
  - `pnpm --filter web build`
  - Manual smoke test of exact filtering and smart search result rendering when local services are available.

## Assumptions

- The UI should demonstrate the same underlying smart-search workflow, not the MCP gateway.
- No new apparel seed data or catalog migration is required.
- Client-side exact search is sufficient for the demo and can be promoted to a backend API later if needed.
