# Audit Log TODO

- Status: active-plan
- Read when: planning follow-up audit history, audit UI, rollback, or future workflow/system mutation work
- Source of truth: `apps/backend/prisma/schema.prisma`, `apps/backend/src/modules/preferences/**`, `apps/backend/test/**`, and the historical docs in `initial-implementation/`
- Last reviewed: 2026-04-18

## Current State

The initial backend audit-log groundwork and MR1 backend read API have shipped.

Shipped behavior:

- one append-only `PreferenceAuditEvent` table for preference and preference-definition mutations
- `subjectSlug` denormalization for slug-history reads
- atomic mutation-plus-audit writes inside backend service transactions
- required `MutationContext` plumbing through GraphQL, document-analysis apply, and MCP mutation entrypoints
- semantic audit events for suggestion accept and reject flows
- provenance carry-through for accepted and rejected suggestions
- user-scoped GraphQL audit history query with cursor pagination
- audit history filters for slug, event type, target type, origin, actor client key, correlation id, and date range
- integration and e2e coverage for the landed audit behavior and read API

Covered mutation paths today:

- GraphQL preference set, suggest, accept, reject, and delete
- GraphQL preference-definition create, update, and archive
- document-analysis apply writes
- MCP preference suggest and delete
- MCP preference-definition create

Current gaps:

- no audit history UI exists yet
- no rollback or revert mechanism exists yet
- no audit backfill exists for pre-audit rows
- `SYSTEM`, `WORKFLOW`, and `IMPORT` actors are schema-ready but not yet wired into real mutation producers
- rejected-suggestion suppression behavior remains unchanged
- no MCP audit read surface exists yet

Historical initial-implementation docs now live under `initial-implementation/`.

## Historical Docs

- `initial-implementation/audit-log-rough-plan.md`
- `initial-implementation/implementation-plan.md`
- `initial-implementation/implementation-summary.md`

## Next Planned Work

### Near Term

1. MR2: add UI for viewing audit history
- add a dedicated audit-history surface in the preferences area
- show provenance metadata plus before/after snapshots
- keep this pass read-only with no rollback controls yet

### Later

2. MR3-MR5: rollback stack
- add revert-preview backend behavior
- add revert execution backend behavior
- add rollback UX after the backend semantics are solid

### Much Later

3. MR6-MR7: producer expansion and operational hardening
- add workflow/system-originated mutation paths and shared context conventions
- revisit pagination tuning, retention, and storage strategy only after real usage data exists

## Open Questions To Resolve During MR1-MR2

- whether the first UI should live as a dedicated page, a preferences tab, or an event drawer off the existing preferences surface
- how much raw snapshot JSON should be exposed directly versus lightly normalized or masked for display
- whether future usage justifies more denormalized query fields beyond `subjectSlug`

## Deferred Work

- add a safe revert helper that computes inverse changes without clobbering newer state
- decide which event types are safely revertable in a first rollback pass
- define metadata conventions for future workflow, system, and import mutation producers
- decide whether MCP needs an audit read surface after the GraphQL + UI path is exercised
- evaluate retention and archival needs after a real demo and usage period
