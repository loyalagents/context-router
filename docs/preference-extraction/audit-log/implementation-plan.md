# Audit Log And Provenance Groundwork Implementation Plan

## Summary
- Add one shared append-only `PreferenceAuditEvent` table for preference and definition mutations.
- Keep scope to persistence, provenance fixes, tx-safe plumbing, targeted tests, and a final `implementation-summary.md`.
- Use explicit required `MutationContext` parameters on mutating service methods.
- Do not backfill existing data.
- Keep `INFERRED` as the live-row label for machine-authored values in groundwork.
- Do not change rejected-suggestion suppression semantics in this PR.

## Key Changes
- Prisma enums:
  - `AuditTargetType = PREFERENCE | PREFERENCE_DEFINITION`
  - `AuditActorType = USER | MCP_CLIENT | SYSTEM | WORKFLOW | IMPORT`
  - `AuditOrigin = GRAPHQL | MCP | DOCUMENT_ANALYSIS | WORKFLOW | SYSTEM`
  - `AuditEventType = PREFERENCE_SET | PREFERENCE_SUGGESTED_UPSERTED | PREFERENCE_SUGGESTION_ACCEPTED | PREFERENCE_SUGGESTION_REJECTED | PREFERENCE_DELETED | DEFINITION_CREATED | DEFINITION_UPDATED | DEFINITION_ARCHIVED`
- `WORKFLOW`, `SYSTEM`, and `IMPORT` are reserved for future use in this PR.
- Prisma model:
  - `PreferenceAuditEvent { id, userId, occurredAt, targetType, targetId, eventType, actorType, actorClientKey?, origin, correlationId, beforeState Json?, afterState Json?, metadata Json? }`
- Indexes:
  - `(userId, occurredAt desc)`
  - `(userId, eventType, occurredAt desc)`
  - `(targetType, targetId, occurredAt desc)`
  - `(correlationId)`
- Snapshot builders live in `apps/backend/src/modules/preferences/audit/snapshot-builders.ts`.
- Snapshot shapes:
  - Preference: `id, userId, definitionId, slug, contextKey, locationId, value, status, sourceType, confidence, evidence, createdAt, updatedAt`
  - Definition: `id, namespace, slug, displayName, description, valueType, scope, options, isSensitive, isCore, archivedAt, ownerUserId, createdAt, updatedAt`
- Audit API:
  - `AuditEventInput { userId, targetType, targetId, eventType, actorType, actorClientKey?, origin, correlationId, beforeState?, afterState?, metadata? }`
  - `PreferenceAuditService.record(event: AuditEventInput, tx?: Prisma.TransactionClient): Promise<void>`
- `MutationContext` is required on every mutating service method.
- `MutationContext` fields:
  - `actorType`
  - `actorClientKey?`
  - `origin`
  - `correlationId`
  - `sourceType`
  - `confidence?`
  - `evidence?`
- Add a comment on `MutationContext`: `sourceType` governs the live row; other fields govern audit provenance.
- `actorClientKey` for MCP mutations comes from `McpContext.client.key`.
- Correlation IDs:
  - Always written on audit rows
  - Reuse caller-supplied IDs when present
  - Otherwise generate UUID v4 values at the resolver or tool boundary with `randomUUID()`
  - `analysisId` is reused as the correlation ID for document-analysis apply flows
- Transaction behavior:
  - Each mutating service method runs inside `prisma.$transaction(...)`
  - Use default PostgreSQL `READ COMMITTED`
  - If the audit insert fails, the whole mutation rolls back
- Repository write-result shape:
  - `PreferenceWriteResult<T> { result: T; beforeState: T | null }`
- Repository provenance options:
  - `PreferenceProvenanceOptions { sourceType: SourceType; confidence?: number | null; evidence?: unknown }`
- Repository signatures use an options bag for provenance:
  - `upsertActive(userId, definitionId, value, locationId?, provenance, tx?)`
  - `upsertSuggested(userId, definitionId, value, locationId?, provenance, tx?)`
  - `upsertRejected(userId, definitionId, value, locationId?, provenance, tx?)`
- Before-state strategy:
  - `upsertActive`, `upsertSuggested`, and `upsertRejected` return `PreferenceWriteResult<T>`
  - `deletePreference`, definition `update`, and definition `archive` use the service’s existing pre-read as `beforeState`
  - Definition `create` uses `beforeState = null`
- Provenance behavior:
  - Manual GraphQL `setPreference` remains `sourceType: USER`
  - GraphQL `suggestPreference` uses `origin: GRAPHQL`, `actorType: USER`, `sourceType: INFERRED`
  - MCP suggestions use `origin: MCP`, `actorType: MCP_CLIENT`, `sourceType: INFERRED`
  - `acceptSuggestion` carries the suggestion’s `sourceType`, `confidence`, and `evidence` onto the ACTIVE row
  - `rejectSuggestion` carries the suggestion’s `confidence` and `evidence` onto the REJECTED row; `sourceType: INFERRED` is already correct on new rejected rows
  - document-analysis apply passes `sourceType: INFERRED`, `confidence`, and `evidence` through `setPreference`
- Rejected-suggestion semantics:
  - This PR does not change the current suppression rule
  - A `REJECTED` row continues to suppress future suggestions for the same user + definition + context
  - Reconsidering whether new evidence/value should bypass a prior rejection is explicitly deferred

## MutationContext Construction Sites
- Preference GraphQL resolver methods:
  - `setPreference`
  - `suggestPreference`
  - `acceptSuggestedPreference`
  - `rejectSuggestedPreference`
  - `deletePreference`
- Definition GraphQL resolver methods:
  - `createPreferenceDefinition`
  - `updatePreferenceDefinition`
  - `archivePreferenceDefinition`
- Document analysis resolver:
  - `applyPreferenceSuggestions`
- MCP tool entrypoints:
  - `PreferenceMutationTool.suggest`
  - `PreferenceMutationTool.delete`
  - `PreferenceDefinitionTool.create`

## Checkpointed Plan
1. Checkpoint 1: audit schema and audit service only.
- Tests first: add `apps/backend/test/integration/preference-audit.repository.spec.ts`
- Cover:
  - enum values
  - origins
  - actor metadata
  - correlation IDs
  - audit insert shape
  - query patterns
- Test snapshot builders with inline fake Prisma-shaped objects
- Implement:
  - audit Prisma model and migration
  - `PreferenceAuditModule`
  - `PreferenceAuditService`
  - snapshot builders
  - `MutationContext` and audit-local shared types
- Run:
  - `pnpm --filter backend prisma:generate`
  - `pnpm --filter backend test:db:migrate`
  - `pnpm --filter backend exec jest test/integration/preference-audit.repository.spec.ts --runInBand`

2. Checkpoint 2a: repository tx plumbing and write-result shape.
- Tests first: update `apps/backend/test/integration/preference.repository.spec.ts`
- Cover:
  - `upsertActive`, `upsertSuggested`, and `upsertRejected` returning `{ result, beforeState }`
  - provenance options bag behavior
  - caller-supplied `sourceType`, `confidence`, and `evidence`
- Add optional `tx?: Prisma.TransactionClient` to mutating preference repository methods:
  - `upsertActive`
  - `upsertSuggested`
  - `upsertRejected`
  - `delete`
- Add optional `tx?: Prisma.TransactionClient` to mutating definition repository methods:
  - `create`
  - `update`
  - `archive`
- CP2a includes the mechanical service-call updates needed to destructure `.result` and `.beforeState`
- Run:
  - `pnpm --filter backend exec jest test/integration/preference.repository.spec.ts --runInBand`

3. Checkpoint 2b: required `MutationContext` wiring on services.
- Tests first: keep existing preference and definition e2e tests passing without audit assertions yet
- Make `MutationContext` a required parameter on:
  - `setPreference`
  - `suggestPreference`
  - `acceptSuggestion`
  - `rejectSuggestion`
  - `deletePreference`
  - `PreferenceDefinitionService.create`
  - `PreferenceDefinitionService.update`
  - `PreferenceDefinitionService.archiveDefinition`
- Wrap each mutating service method in `prisma.$transaction(...)`
- Run:
  - `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts test/e2e/preference-definition-mutations.e2e-spec.ts --runInBand`

4. Checkpoint 3: GraphQL preference audit writes.
- Tests first: update `apps/backend/test/e2e/preferences.e2e-spec.ts`
- Assert after GraphQL `setPreference`:
  - exactly 1 audit row
  - `eventType = PREFERENCE_SET`
  - `origin = GRAPHQL`
  - `actorType = USER`
  - non-null `afterState` matching the written preference
  - non-empty `correlationId`
- Assert after GraphQL `suggestPreference`:
  - exactly 1 audit row
  - `eventType = PREFERENCE_SUGGESTED_UPSERTED`
  - `origin = GRAPHQL`
  - `actorType = USER`
  - `afterState.status = SUGGESTED`
- Assert after delete:
  - `eventType = PREFERENCE_DELETED`
  - non-null `beforeState`
  - null `afterState`
- Confirm manual `setPreference` stays `sourceType: USER`
- Run:
  - `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts --runInBand`

5. Checkpoint 4: accept/reject semantic events and provenance carry-through.
- Tests first: extend `apps/backend/test/e2e/preferences.e2e-spec.ts`
- Assert accept:
  - ACTIVE row `sourceType = INFERRED`
  - ACTIVE row keeps suggestion `confidence` and `evidence`
  - audit row `eventType = PREFERENCE_SUGGESTION_ACCEPTED`
  - `metadata.consumedSuggestion` present
- Assert reject:
  - REJECTED row keeps suggestion `confidence` and `evidence`
  - audit row `eventType = PREFERENCE_SUGGESTION_REJECTED`
  - `metadata.consumedSuggestion` present
- Assert the existing suppression behavior remains unchanged:
  - once a suggestion is rejected, a later suggestion for the same definition + context is skipped
- Run:
  - `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts --runInBand`

6. Checkpoint 5: document-analysis provenance.
- Tests first: update `apps/backend/test/e2e/document-analysis.e2e-spec.ts`
- Extend `ApplyPreferenceSuggestionInput` with optional:
  - `confidence`
  - `evidence`
- Assert:
  - `analysisId` becomes `correlationId`
  - applied suggestions write ACTIVE rows as `INFERRED`
  - audit rows have `origin = DOCUMENT_ANALYSIS`
  - partial-failure batches produce audit rows only for successful writes and no failure audit rows
- Implement explicit required `MutationContext` construction in `DocumentAnalysisResolver`
- Run:
  - `pnpm --filter backend exec jest test/e2e/document-analysis.e2e-spec.ts --runInBand`

7. Checkpoint 6: definition audit and MCP actor propagation.
- Tests first: update `apps/backend/test/e2e/preference-definition-mutations.e2e-spec.ts` and `apps/backend/test/e2e/mcp.e2e-spec.ts`
- Assert definition create/update/archive:
  - exactly 1 audit row per mutation
  - correct `eventType`
  - `origin = GRAPHQL` for resolver path
  - correct `beforeState` / `afterState`
- Assert MCP writes:
  - `actorType = MCP_CLIENT`
  - `actorClientKey = context.client.key`
  - `origin = MCP`
  - non-empty `correlationId`
- Run:
  - `pnpm --filter backend exec jest test/e2e/preference-definition-mutations.e2e-spec.ts --runInBand`
  - `pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts --runInBand`

8. Checkpoint 7: final validation sweep.
- Run:
  - `pnpm --filter backend test:integration`
  - `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts test/e2e/document-analysis.e2e-spec.ts test/e2e/preference-definition-mutations.e2e-spec.ts test/e2e/mcp.e2e-spec.ts --runInBand`
- Manual verification:
  - one manual GraphQL set
  - one GraphQL suggest
  - one accepted suggestion
  - one rejected suggestion
  - one document-analysis apply with partial success
  - one MCP suggestion
  - one MCP definition create

9. Checkpoint 8: implementation summary doc.
- Write `docs/preference-extraction/audit-log/implementation-summary.md`
- Describe what actually landed, not the intended design
- Include:
  - what shipped
  - Prisma model and enums that landed
  - event taxonomy that landed
  - provenance behavior changes
  - resolver, service, repository, module, and MCP entrypoints changed
  - tests added or updated
  - verification commands run
  - known limitations and deferred work
  - `TODO / Future Steps` section that explicitly includes:
    - a read API for audit events
    - rollback UX
    - a revert mechanism for applying inverse changes safely
  - explicit note that changing rejected-suggestion suppression behavior was out of scope:
    - current behavior still suppresses future suggestions for the same user + definition + context after rejection
    - redesigning that rule is deferred future work

## Assumptions And Boundary
- `userId` on audit rows means the affected user or resource owner in the current single-user mutation model.
- Existing preferences and definitions will have no retroactive audit history.
- Groundwork PR includes:
  - audit table + migration
  - `PreferenceAuditModule`
  - audit service + snapshot builders
  - tx-aware repository and service plumbing
  - required `MutationContext` wiring
  - provenance-aware live-row writes
  - audit emission for preference and definition mutations
  - document-analysis provenance passthrough
  - MCP actor propagation
  - targeted integration and e2e coverage
  - `implementation-summary.md`
- Groundwork PR does not include:
  - audit read API or UI
  - permission redesign
  - full-auto write or define endpoints
  - rollback UX
  - persisted document-analysis artifacts
  - audit rows for failed document-analysis apply attempts
  - changes to rejected-suggestion suppression semantics
