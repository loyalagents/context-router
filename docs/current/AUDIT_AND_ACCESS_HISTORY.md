# Audit and Access History

- Status: current
- Read when: changing preference mutations, mutation attribution, MCP access
  logging, history queries, reset behavior, or history UI
- Source of truth: `apps/backend/prisma/schema.prisma`,
  `apps/backend/src/modules/preferences/audit/**`,
  `apps/backend/src/mcp/access-log/**`, preference and definition services,
  `apps/backend/test/e2e/audit-history.e2e-spec.ts`, and
  `apps/backend/test/e2e/mcp-access-log.e2e-spec.ts`, and
  `apps/backend/test/local-database/application.spec.ts`
- Last reviewed: 2026-09-23

The application keeps three related but distinct records:

- `PreferenceAuditEvent` records a domain mutation and its provenance.
- `McpAccessEvent` records an MCP request and its outcome.
- `Preference.lastModifiedBy` exposes compact attribution on a live row.

Do not treat one as a substitute for another. An unsuccessful MCP mutation can
have an access event without a domain audit event, while a GraphQL mutation can
have a domain audit event without an MCP access event.

The Step 03 destructive fresh-data schema transition intentionally carries no
historical user's mutation or access history forward. The default local preview composes GraphQL history resolvers over SQLite; the explicit PostgreSQL reference preview retains its loopback TLS database. Both expose no listener or MCP transport, so neither creates local MCP access events through a transport.

## Mutation audit events and provenance

`PreferenceAuditEvent` is user-scoped and records the subject slug, occurrence
time, target type and id, event type, actor type and optional MCP client key,
origin, correlation id, normalized before/after snapshots, and optional
metadata. Current event types cover:

- active preference set, suggestion upsert, suggestion acceptance, suggestion
  rejection, preference deletion, and aggregate preference reset;
- preference-definition creation, update, and archive.

Preference and definition services write the domain change and its audit event
inside the same application-owned unit of work, implemented by PostgreSQL for hosted/reference composition and SQLite for local composition. If the audit insert fails, the domain write
rolls back; if the domain write fails, no corresponding audit row commits.
Snapshots are normalized application views rather than raw Prisma records, so
history consumers do not need to reconstruct the live row shape.
The [storage boundary](STORAGE_BOUNDARIES.md) defines callback lifetime, error
classification and the separate best-effort access append.

The mutation context separates value provenance from mutation provenance:

- `sourceType`, `confidence`, and `evidence` describe the value.
- `actorType`, `actorClientKey`, and `origin` describe who or what performed the
  mutation.
- `correlationId` links related work, including MCP dispatch and document
  analysis apply operations.

Accepting an inferred suggestion preserves its value provenance on the active
row while recording the consuming user and surface in the audit event.
Rejection preserves the consumed suggestion's confidence and evidence on the
rejected row. Accept and reject events also carry a normalized copy of the
consumed suggestion in metadata.

A suppressed suggestion is a successful no-op: it creates neither a preference
write nor a domain audit event. Ordinary mutation history is append-only, but
the advanced reset modes deliberately delete the current user's mutation
history; see `DATA_RESET.md`.

## Live preference attribution

`lastModifiedBy` is a nullable projection on a live preference row with:

- `actorType`
- nullable `actorClientKey`
- `origin`

It is distinct from `sourceType`. For example, a user can accept an inferred
suggestion: the resulting value remains `INFERRED`, while `lastModifiedBy`
identifies the user action. Normal preference-service active and suggested
mutations populate the fields. Rejected tombstones, rows that predate the
feature, and profile rows inserted directly from verified identity hints can return
`null`.

The dashboard uses this attribution for labels such as the current user,
document analysis, or a named MCP client. Its AI badge is based on
`sourceType: INFERRED`, not on the last actor.

## MCP access history

`McpAccessEvent` is a separate, request-level record for `tools/call` and
`resources/read`. It stores the user and MCP client, operation, surface,
`SUCCESS`/`DENY`/`ERROR` outcome, correlation id, latency, and sanitized
request, response, or error metadata.

Current dispatch logging includes:

- known read-only tool calls and resource reads;
- unknown tool calls and resource reads as dispatch errors;
- authorization denials, handler exceptions, and tool results marked as
  errors; and
- every `mutatePreferences` attempt that reaches MCP dispatch. That tool opts
  into always-on logging, so successes, target-level denials, validation errors,
  handler errors, and coarse dispatch denials are represented.

Metadata records safe shapes, counts, operation names, error sources/codes, and
selected object ids. It does not record raw natural-language queries,
preference values, evidence, complete slug lists, AI interpretations, or full
response bodies.

Access logging is best-effort and fail-open. It runs outside the domain mutation
transaction, so a logging failure does not fail or mask the MCP operation. It
also means an access event and a domain audit event are not one atomic record;
use their shared correlation id when both exist.

The following are not logged today:

- `tools/list` or `resources/list` discovery;
- authentication failures that occur before MCP dispatch;
- one event per object returned or changed;
- an MCP tool/resource for reading access history; or
- global administrative telemetry or retention/archival behavior.

## History query contract

The authenticated GraphQL queries `preferenceAuditHistory(input)` and
`mcpAccessHistory(input)` always constrain results to the current user. Both:

- default `first` to 20 and cap it at 100;
- combine supplied filters with AND semantics;
- use a stable `(occurredAt DESC, id DESC)` cursor;
- expose `items`, `nextCursor`, and `hasNextPage`;
- accept inclusive `occurredFrom` and `occurredTo` bounds; and
- reject a malformed cursor with a bad-request error.

Audit history supports a trimmed prefix match on `subjectSlug`, plus exact
event type, target type, origin, actor-client key, and correlation-id filters.
The slug prefix applies to preference and definition events; use `targetType`
when callers need to distinguish them.

MCP access history supports exact client, surface, operation, outcome, and
correlation-id filters. The API returns stored audit snapshots and already-
sanitized MCP metadata. Dashboard masking is a presentation safeguard, not
additional API redaction.

## Dashboard history

`/dashboard/history` exposes lazy-loaded Audit and MCP Access tabs. Both support
filters, applied-filter chips, reset, cursor-based load-more behavior, and
expandable JSON details.

The Audit tab hides values by default when the subject slug is marked sensitive
in the current live catalog. An archived or deleted definition can no longer be
present in that catalog, so its historical value may not receive that UI mask.
The MCP tab renders sanitized JSON metadata rather than a specialized tree.

There is no rollback or revert action in either history tab.

## Known limitations

- Existing rows were not backfilled when domain audit or live attribution was
  introduced.
- Advanced reset modes erase audit and access evidence for the current user.
- Mutation history has no rollback API or concurrency-safe revert workflow.
- MCP access history is request-level, has no retention policy, and excludes
  pre-dispatch authentication failures and discovery calls.
- Sensitive-value masking depends on current catalog membership and is only a
  UI behavior.
