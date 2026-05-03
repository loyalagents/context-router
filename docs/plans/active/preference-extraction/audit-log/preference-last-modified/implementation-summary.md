# Preference Last Modified Attribution Implementation Summary

## What Changed

- Added nullable `last_actor_type`, `last_actor_client_key`, and `last_origin` columns to `user_preferences`.
- Reused existing `AuditActorType` and `AuditOrigin` enums for current-row attribution.
- Added backend `PreferenceAttribution` GraphQL type and nullable `Preference.lastModifiedBy`.
- Kept value provenance separate from mutation attribution by adding `PreferenceMutationAttribution` alongside existing `PreferenceProvenanceOptions`.
- Updated active and suggested preference writes to persist last-modifier attribution from `MutationContext`.
- Extended accept-suggestion behavior so the active row keeps suggestion value provenance while recording the accepting user as the last modifier.
- Left rejected tombstone rows without last-modifier plumbing in v1; rejection attribution remains in the audit event.
- Included `lastModifiedBy` in preference audit snapshots.
- Updated MCP mutation output, preferences dashboard queries, local frontend preference types, mutation fragments, and preference-card rendering.
- Added follow-up coverage for rejected tombstones staying attribution-null and for GraphQL-to-MCP overwrites preserving before/after attribution in audit snapshots.

## UI Behavior

- Existing `AI` badge still comes only from `sourceType === INFERRED`.
- Preference cards now render:
  - `Modified by you` for dashboard GraphQL edits.
  - `Modified by document analysis` for document-analysis apply writes.
  - `Modified by codex`, `Modified by claude`, and similar labels for MCP client writes.

## Tests And Verification

- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend test:db:up`
- `pnpm --filter backend test:db:migrate`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest test/integration/preference.repository.spec.ts test/integration/preference-audit.repository.spec.ts --runInBand`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts test/e2e/mcp.e2e-spec.ts test/e2e/document-analysis.e2e-spec.ts --runInBand`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts --runInBand`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest src/modules/preferences/document-analysis/preference-extraction.service.spec.ts src/modules/workflows/preferences/preference-search/preference-search.workflow.spec.ts --runInBand`
- `pnpm --filter web codegen`
- `pnpm --filter web build`

## Notes

- Existing rows can have `lastModifiedBy = null` until rewritten.
- Source-detail attribution such as `AI · codex` was intentionally deferred; v1 only tracks and displays last modifier.
- The web build passed with existing Auth0 environment warnings and Edge-runtime warnings from Auth0 dependencies.
