# Audit Log TODO

- Status: active-plan
- Read when: planning follow-up audit history, audit UI, rollback, or future workflow/system mutation work
- Source of truth: `apps/backend/prisma/schema.prisma`, `apps/backend/src/modules/preferences/**`, `apps/backend/test/**`, and the historical docs in `initial-implementation/`
- Last reviewed: 2026-04-18

## Current State

The initial backend audit-log groundwork, MR1 backend read API, and MR2 read-only history UI have shipped.

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
- read-only audit history page linked from the main dashboard and preferences page
- lazy-loaded history rows with expandable before/after/metadata panels
- visible common filters plus advanced filters behind a disclosure
- sensitivity masking toggle in the UI using the live preference catalog

Covered mutation paths today:

- GraphQL preference set, suggest, accept, reject, and delete
- GraphQL preference-definition create, update, and archive
- document-analysis apply writes
- MCP preference suggest and delete
- MCP preference-definition create

Current gaps:

- no rollback or revert mechanism exists yet
- no audit backfill exists for pre-audit rows
- `SYSTEM`, `WORKFLOW`, and `IMPORT` actors are schema-ready but not yet wired into real mutation producers
- rejected-suggestion suppression behavior remains unchanged
- no MCP read/access logging exists yet for MCP tools or resources
- no MCP audit read surface exists yet
- archived or deleted definitions may lose sensitivity masking in the history UI because MR2 only uses the live catalog

Historical initial-implementation docs now live under `initial-implementation/`.

## Historical Docs

- `initial-implementation/audit-log-rough-plan.md`
- `initial-implementation/implementation-plan.md`
- `initial-implementation/implementation-summary.md`

## Next Planned Work

### Near Term

1. MR3-MR5: rollback stack
- add revert-preview backend behavior
- add revert execution backend behavior
- add rollback UX after the backend semantics are solid

### Later

2. MR6-MR7: producer expansion and operational hardening
- add workflow/system-originated mutation paths and shared context conventions
- revisit pagination tuning, retention, and storage strategy only after real usage data exists

### Much Later

3. Follow-up audit UI refinements
- decide whether the history page should gain URL-synced filters or saved views
- revisit JSON presentation if raw payloads prove hard to scan in real usage
- revisit sensitivity detection if archived-definition masking becomes important

4. MCP log track: add MCP read/access logging, read APIs, and UX
- prefer a separate request-level MCP log table rather than stretching `PreferenceAuditEvent`
- instrument `McpService` centrally for `tools/call` and `resources/read`
- allow tool/resource-specific sanitized metadata where base request logging is too thin
- add a backend read surface with filters for client, operation, outcome, and time
- add an MCP access tab inside the existing history experience rather than creating a separate history surface

## Open Questions To Resolve After MR2

- how much raw snapshot JSON should be exposed directly versus lightly normalized or masked for display
- whether future usage justifies more denormalized query fields beyond `subjectSlug`
- whether the history UI should gain URL-synced filters or saved views after the first demo pass

## Open Questions For MCP Logging

- should `tools/list` and `resources/list` count as logged access events or only `tools/call` and `resources/read`
- whether returned slugs should be logged directly in MCP read metadata or whether counts are enough for v1
- whether the first MCP log API should be user-scoped GraphQL, admin-facing, or both
- whether failed auth before MCP dispatch should appear in the same history surface or remain only in operational logs
- how much filter state, page chrome, and detail rendering should be shared between the existing audit history view and a future MCP access tab
- whether object-level access logging is ever needed, or whether request-level logs are enough

## Deferred Work

- add a safe revert helper that computes inverse changes without clobbering newer state
- decide which event types are safely revertable in a first rollback pass
- define metadata conventions for future workflow, system, and import mutation producers
- decide whether MCP needs its own MCP-protocol audit read surface after the GraphQL + UI path is exercised
- evaluate retention and archival needs after a real demo and usage period
- evaluate whether MCP access history needs per-object fan-out after request-level logging has real usage data
