# Audit Log TODO

- Status: active-plan
- Read when: planning follow-up audit history, audit UI, rollback, or future workflow/system mutation work
- Source of truth: `apps/backend/prisma/schema.prisma`, `apps/backend/src/modules/preferences/**`, `apps/backend/test/**`, and the historical docs in `initial-implementation/`
- Last reviewed: 2026-04-18

## Current State

The initial backend audit-log groundwork has shipped.

Shipped behavior:

- one append-only `PreferenceAuditEvent` table for preference and preference-definition mutations
- atomic mutation-plus-audit writes inside backend service transactions
- required `MutationContext` plumbing through GraphQL, document-analysis apply, and MCP mutation entrypoints
- semantic audit events for suggestion accept and reject flows
- provenance carry-through for accepted and rejected suggestions
- integration and e2e coverage for the landed audit behavior

Covered mutation paths today:

- GraphQL preference set, suggest, accept, reject, and delete
- GraphQL preference-definition create, update, and archive
- document-analysis apply writes
- MCP preference suggest and delete
- MCP preference-definition create

Current gaps:

- no read API or query surface exists yet for audit events
- no audit history UI exists yet
- no rollback or revert mechanism exists yet
- no audit backfill exists for pre-audit rows
- `SYSTEM`, `WORKFLOW`, and `IMPORT` actors are schema-ready but not yet wired into real mutation producers
- rejected-suggestion suppression behavior remains unchanged

Historical initial-implementation docs now live under `initial-implementation/`.

## Historical Docs

- `initial-implementation/audit-log-rough-plan.md`
- `initial-implementation/implementation-plan.md`
- `initial-implementation/implementation-summary.md`

## Next Planned Work

### Near Term

1. MR1: add a backend audit read API
- start with a user-scoped GraphQL read surface
- support pagination and filters that fit the current schema and indexes well
- add targeted integration and e2e coverage

2. MR2: add UI for viewing audit history
- add a dedicated audit-history surface in the preferences area
- show provenance metadata plus before/after snapshots
- keep this pass read-only with no rollback controls yet

### Later

3. MR3-MR5: rollback stack
- add revert-preview backend behavior
- add revert execution backend behavior
- add rollback UX after the backend semantics are solid

### Much Later

4. MR6-MR7: producer expansion and operational hardening
- add workflow/system-originated mutation paths and shared context conventions
- revisit pagination tuning, retention, and storage strategy only after real usage data exists

## Open Questions To Resolve During MR1-MR2

- what GraphQL audit event shape is the smallest useful read contract for the UI
- whether v1 history queries should rely only on the current indexed fields or also denormalize more query fields later
- whether the first UI should live as a dedicated page, a preferences tab, or an event drawer off the existing preferences surface
- how much raw snapshot JSON should be exposed directly versus lightly normalized for display

## Deferred Work

- add a safe revert helper that computes inverse changes without clobbering newer state
- decide which event types are safely revertable in a first rollback pass
- define metadata conventions for future workflow, system, and import mutation producers
- evaluate retention and archival needs after a real demo and usage period
