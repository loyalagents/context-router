## MR1 Backend Audit Read API With `subjectSlug`

### Summary
Add a user-scoped GraphQL audit read API and make slug history first-class by denormalizing `subjectSlug` onto `PreferenceAuditEvent`. Keep full JSON snapshots as the durable audit detail, and use `subjectSlug` only as a read-optimized query dimension. Also add the read-api planning docs before implementation, and add the implementation summary plus `TODO.md` update after the work ships.

### Implementation Changes
- Extend `PreferenceAuditEvent` with `subjectSlug: string` and add an index on `(userId, subjectSlug, occurredAt desc)`.
- Rewrite the existing audit migration instead of adding a follow-up migration, since the environments will be reset anyway.
- Keep the existing `(userId, occurredAt desc)` and `(userId, eventType, occurredAt desc)` indexes for unfiltered and event-type-filtered reads. Do not add extra compound slug indexes in MR1.
- Extend the audit write contract so `subjectSlug` is required on every audit write.
- Add a defensive runtime invariant in `PreferenceAuditService.record()` that throws immediately if `subjectSlug` is falsy. This is a programmer-error guard, not a user-facing validation path.
- Populate `subjectSlug` from the already-available logical subject on each mutation path. Do not derive it by re-parsing `beforeState` or `afterState` JSON inside the audit service.
- Keep `beforeState`, `afterState`, and `metadata` unchanged as the full audit detail.
- Add a dedicated audit read service and resolver under the audit module rather than extending the preference or definition resolvers.
- Follow the repo’s GraphQL model convention with dedicated `*.model.ts` files for the new GraphQL types.

### Public API
Add a GraphQL query:
- `preferenceAuditHistory(input: PreferenceAuditHistoryInput!): PreferenceAuditHistoryPage!`

Add input type:
- `PreferenceAuditHistoryInput`
- Fields:
  - `first: Int` with server default `20`, minimum `1`, maximum `100`
  - `after: String`
  - `subjectSlug: String`
  - `eventType: AuditEventType`
  - `targetType: AuditTargetType`
  - `origin: AuditOrigin`
  - `actorClientKey: String`
  - `correlationId: String`
  - `occurredFrom: DateTime`
  - `occurredTo: DateTime`

Add page type:
- `PreferenceAuditHistoryPage`
- Fields:
  - `items: [PreferenceAuditEvent!]!`
  - `nextCursor: String`
  - `hasNextPage: Boolean!`

Add GraphQL event type:
- `PreferenceAuditEvent`
- Fields:
  - `id`, `userId`, `occurredAt`, `subjectSlug`
  - `targetType`, `targetId`, `eventType`
  - `actorType`, `actorClientKey`, `origin`, `correlationId`
  - `beforeState`, `afterState`, `metadata` as JSON scalars

Query semantics:
- Always scope by authenticated `userId`.
- All supplied filters `AND`-compose.
- `subjectSlug` is an exact match on the canonical stored slug.
- `subjectSlug` matches both preference and definition events by default.
- `targetType` is optional and narrows slug history when the caller wants only preference-value or only definition events.
- Date filters are inclusive: `occurredAt >= occurredFrom` and `occurredAt <= occurredTo`.
- Order by `occurredAt desc, id desc`.
- Use an opaque cursor that encodes both `occurredAt` and `id`.
- Cursor pagination semantics:
  - decode the cursor into `(occurredAt, id)`
  - fetch rows where `occurredAt < cursor.occurredAt` or `occurredAt = cursor.occurredAt and id < cursor.id`
  - fetch `first + 1` rows to determine `hasNextPage`
  - `nextCursor` is built from the last returned item when another page exists
- A malformed or tampered cursor must raise a `BadRequestException` with a clear error message.
- Empty results return `items: []`, `hasNextPage: false`, `nextCursor: null`.
- Do not return `totalCount`.
- Do not join live preference or definition tables; read only from the audit table.
- No MCP audit read tool or MCP audit resource is added in MR1.

### Checkpoints
1. Planning docs
- Update `docs/plans/active/preference-extraction/audit-log/read-api/implementation-plan.md` with the final MR1 decisions before implementation starts.
- Capture `subjectSlug`, filter semantics, pagination behavior, error handling, and scope boundaries there.
- Do not create an implementation summary yet.

2. `subjectSlug` schema and write-path plumbing
- Update Prisma schema and rewrite the existing audit migration to add `subjectSlug` and the new index.
- Extend `AuditEventInput` so `subjectSlug` is required.
- Add the runtime invariant in `PreferenceAuditService.record()`.
- Update every audit-producing path to pass `subjectSlug`.
- Update the audit integration test to assert `subjectSlug` persistence and to fail loudly if a write path omits it.
- Validation checkpoint: Prisma generate, test DB migrate, audit integration test.

3. Audit read service
- Add GraphQL enum registrations for the audit enums.
- Add the audit read input, page, and event GraphQL models.
- Implement a dedicated query service that maps GraphQL filters to Prisma queries and applies stable cursor pagination.
- Implement explicit cursor parsing and validation in the query service.
- Validation checkpoint: integration tests for ordering, pagination, empty results, cursor validation, filter composition, and user isolation.

4. GraphQL resolver and schema
- Add `preferenceAuditHistory` resolver under the audit module.
- Ensure the generated schema file includes the new query and types.
- Validation checkpoint: focused e2e query tests against the GraphQL surface.

5. End-to-end history scenarios
- Seed audit history through real mutation flows, then query through GraphQL.
- Cover mixed history for one slug across both target types, plus narrowing via `targetType`.
- Cover `origin`, `actorClientKey`, `eventType`, `correlationId`, and date-range filters.
- Validation checkpoint: targeted e2e suite for MR1 audit history.

6. Post-implementation docs
- Add `docs/plans/active/preference-extraction/audit-log/read-api/implementation-summary.md` describing what actually shipped.
- Update [TODO.md](/Users/lucasnovak/loyal-agents/context-router/docs/plans/active/preference-extraction/audit-log/TODO.md) to mark MR1 complete, note the shipped read API and `subjectSlug`, and leave MR2 as the next planned work.
- In the summary and TODO update, explicitly note that MCP audit reads remain out of scope.

### Test Plan
- Integration:
  - `PreferenceAuditService.record` persists `subjectSlug`.
  - `PreferenceAuditService.record` throws immediately when `subjectSlug` is missing.
  - Query service returns newest-first ordering with `occurredAt desc, id desc`.
  - Cursor pagination returns a stable next page with no duplicates or skips.
  - Malformed cursor input returns a clear `BadRequestException`.
  - Empty result sets return `items: []`, `hasNextPage: false`, `nextCursor: null`.
  - `subjectSlug` filter returns both preference and definition events for the slug.
  - `targetType` narrows a `subjectSlug` history correctly.
  - `origin`, `actorClientKey`, `eventType`, `correlationId`, and date-range filters compose correctly with `AND` semantics.
  - User isolation prevents one user from seeing another user’s audit events.

- E2E:
  - Create, update, archive a definition, then set, suggest, accept, reject, delete preferences on the same slug, and verify the history query returns the expected mixed timeline.
  - Verify MCP-generated events can be filtered by `actorClientKey` such as `claude` and `codex`.
  - Verify document-analysis events can be filtered by `origin = DOCUMENT_ANALYSIS`.
  - Verify a `subjectSlug` query with no `targetType` includes both value and definition history.
  - Verify `targetType = PREFERENCE` and `targetType = PREFERENCE_DEFINITION` each return the expected subset.
  - Verify a slug with no history returns a clean empty page.

### Assumptions And Defaults
- `subjectSlug` is required for all new audit writes; no nullable transitional state is needed.
- Existing environments will be reset, so rewriting the current audit migration is acceptable and no backfill logic is needed.
- `actorClientKey` remains a plain string filter, not an enum, so future non-managed client keys remain queryable.
- The first read API exposes raw snapshot JSON directly; no additional UI-oriented normalization is added in MR1.
- Sensitive snapshot values remain readable to the owning user in MR1. Any masking or special display treatment is deferred to MR2.
- `read-api/implementation-plan.md` is updated before implementation starts.
- `read-api/implementation-summary.md` and `TODO.md` updates happen after implementation is complete and verified.
- Multi-select filters, `actorType` filtering, rollback-related query behavior, and MCP audit reads are out of scope for MR1.
