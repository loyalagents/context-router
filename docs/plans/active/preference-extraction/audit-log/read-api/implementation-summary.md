# MR1 Read API Implementation Summary

## What shipped

MR1 shipped a user-scoped GraphQL read surface for audit history and added a denormalized slug column for first-class slug history queries.

Shipped scope:

- `subjectSlug` added to `PreferenceAuditEvent`
- audit write paths updated so every event records `subjectSlug`
- runtime guard in the audit service to fail fast if a write path omits `subjectSlug`
- GraphQL query `preferenceAuditHistory(input)` with cursor pagination
- filter support for `subjectSlug`, `eventType`, `targetType`, `origin`, `actorClientKey`, `correlationId`, and inclusive date range
- targeted integration and e2e coverage for pagination, filters, and user isolation

Still out of scope:

- MCP audit read tool or resource
- audit history UI
- rollback or revert behavior
- masking or special display handling for sensitive snapshot values

## Schema and write-path changes

Prisma changes:

- `PreferenceAuditEvent.subjectSlug`
- index on `(userId, subjectSlug, occurredAt desc)`

Audit write behavior:

- `AuditEventInput.subjectSlug` is required
- `PreferenceAuditService.record()` throws immediately if `subjectSlug` is empty
- preference mutation events write the affected preference slug
- definition mutation events write the affected definition slug

The full JSON snapshots remain unchanged:

- `beforeState`
- `afterState`
- `metadata`

## Read API contract

GraphQL query:

- `preferenceAuditHistory(input: PreferenceAuditHistoryInput!): PreferenceAuditHistoryPage!`

Returned data:

- top-level event metadata including `subjectSlug`
- raw `beforeState`, `afterState`, and `metadata` JSON
- `items`, `hasNextPage`, and `nextCursor`

Read semantics:

- always scoped to the authenticated user
- all supplied filters AND-compose
- `subjectSlug` matches both preference and definition events by default
- `targetType` can narrow the history to one target type
- ordering is `occurredAt desc, id desc`
- cursor encodes `(occurredAt, id)`
- malformed cursors return a clear request validation error

## Tests and verification

Added:

- `apps/backend/test/integration/preference-audit-query.service.spec.ts`
- `apps/backend/test/e2e/audit-history.e2e-spec.ts`

Updated:

- `apps/backend/test/integration/preference-audit.repository.spec.ts`

Verification run:

- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend test:db:up`
- `pnpm --filter backend test:db:migrate`
- `pnpm --filter backend exec jest test/integration/preference-audit.repository.spec.ts --runInBand`
- `pnpm --filter backend exec jest test/integration/preference-audit-query.service.spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts test/e2e/document-analysis.e2e-spec.ts test/e2e/preference-definition-mutations.e2e-spec.ts test/e2e/mcp.e2e-spec.ts test/e2e/audit-history.e2e-spec.ts --runInBand`
- `pnpm --filter backend test:integration`

## Notes

- The existing audit migration was rewritten instead of adding a follow-up migration because the current environments were reset anyway.
- The first read API exposes raw snapshot JSON directly so MR2 can decide how much normalization or masking the UI needs.
- MCP audit reads remain intentionally out of scope for this MR.
