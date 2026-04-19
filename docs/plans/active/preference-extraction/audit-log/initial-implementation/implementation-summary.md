# Preference Audit Log Implementation Summary

## What shipped

This change set adds backend audit-log groundwork for preference and preference-definition mutations.

Shipped scope:

- append-only audit persistence for preference and preference-definition mutations
- atomic mutation-plus-audit writes inside backend service transactions
- provenance plumbing through GraphQL, document-analysis, and MCP mutation paths
- semantic audit events for suggestion accept and reject flows
- integration and e2e coverage for the new audit behavior

Out of scope and still not shipped:

- audit read APIs
- rollback or revert UX
- backfill for existing preferences or definitions
- frontend work for document-analysis apply
- rejected-suggestion suppression redesign

## Prisma model and enums that landed

Added enums:

- `AuditTargetType`
  - `PREFERENCE`
  - `PREFERENCE_DEFINITION`
- `AuditActorType`
  - `USER`
  - `MCP_CLIENT`
  - `SYSTEM`
  - `WORKFLOW`
  - `IMPORT`
- `AuditOrigin`
  - `GRAPHQL`
  - `MCP`
  - `DOCUMENT_ANALYSIS`
  - `WORKFLOW`
  - `SYSTEM`
- `AuditEventType`
  - `PREFERENCE_SET`
  - `PREFERENCE_SUGGESTED_UPSERTED`
  - `PREFERENCE_SUGGESTION_ACCEPTED`
  - `PREFERENCE_SUGGESTION_REJECTED`
  - `PREFERENCE_DELETED`
  - `DEFINITION_CREATED`
  - `DEFINITION_UPDATED`
  - `DEFINITION_ARCHIVED`

Added model:

- `PreferenceAuditEvent`
  - `id`
  - `userId`
  - `occurredAt`
  - `targetType`
  - `targetId`
  - `eventType`
  - `actorType`
  - `actorClientKey`
  - `origin`
  - `correlationId`
  - `beforeState`
  - `afterState`
  - `metadata`

Added indexes:

- `(userId, occurredAt desc)`
- `(userId, eventType, occurredAt desc)`
- `(targetType, targetId, occurredAt desc)`
- `(correlationId)`

Migration added:

- [`apps/backend/prisma/migrations/20260418120000_add_preference_audit_events/migration.sql`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/prisma/migrations/20260418120000_add_preference_audit_events/migration.sql)

## Event taxonomy that landed

Preference events:

- `PREFERENCE_SET`
  - emitted for live preference writes through `setPreference`
- `PREFERENCE_SUGGESTED_UPSERTED`
  - emitted when a suggestion row is created or refreshed
- `PREFERENCE_SUGGESTION_ACCEPTED`
  - emitted when a suggestion is consumed into an ACTIVE row
- `PREFERENCE_SUGGESTION_REJECTED`
  - emitted when a suggestion is consumed into a REJECTED row
- `PREFERENCE_DELETED`
  - emitted when a preference row is deleted

Preference-definition events:

- `DEFINITION_CREATED`
- `DEFINITION_UPDATED`
- `DEFINITION_ARCHIVED`

## Provenance behavior changes

New mutation context is now required on mutating backend service methods:

- `actorType`
- `actorClientKey?`
- `origin`
- `correlationId`
- `sourceType`
- `confidence?`
- `evidence?`

Behavior now enforced:

- manual GraphQL `setPreference` keeps `sourceType: USER`
- GraphQL `suggestPreference` records `origin: GRAPHQL`, `actorType: USER`, and still writes suggestion rows as inferred machine-originated values
- document-analysis apply now carries `confidence` and `evidence` into the live ACTIVE row and records `origin: DOCUMENT_ANALYSIS`
- document-analysis apply reuses `analysisId` as the audit `correlationId`
- MCP preference and definition mutations now record `actorType: MCP_CLIENT`, `actorClientKey`, and `origin: MCP`
- accepting a suggestion preserves the consumed suggestion’s `sourceType`, `confidence`, and `evidence` on the resulting ACTIVE row
- rejecting a suggestion preserves the consumed suggestion’s `confidence` and `evidence` on the resulting REJECTED row, while keeping rejected rows `sourceType: INFERRED`
- suggestion accept and reject audit events include `metadata.consumedSuggestion`

Behavior intentionally preserved:

- manual GraphQL set remains a direct ACTIVE upsert
- suggestions remain suggestion-first
- accept and reject still consume the suggestion row
- rejected suggestions still suppress future suggestions for the same definition and context

## Core implementation pieces

New audit module and service:

- [`apps/backend/src/modules/preferences/audit/preference-audit.module.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/audit/preference-audit.module.ts)
- [`apps/backend/src/modules/preferences/audit/preference-audit.service.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/audit/preference-audit.service.ts)
- [`apps/backend/src/modules/preferences/audit/audit.types.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/audit/audit.types.ts)
- [`apps/backend/src/modules/preferences/audit/snapshot-builders.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/audit/snapshot-builders.ts)

Repository plumbing:

- preference repository mutators now accept provenance options and optional transaction clients
- preference upsert methods now return `PreferenceWriteResult<T>`, including `beforeState`
- preference-definition repository mutators now accept optional transaction clients

## Resolver, service, repository, module, and MCP entrypoints changed

GraphQL resolver entrypoints:

- [`apps/backend/src/modules/preferences/preference/preference.resolver.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference/preference.resolver.ts)
- [`apps/backend/src/modules/preferences/preference-definition/preference-definition.resolver.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference-definition/preference-definition.resolver.ts)
- [`apps/backend/src/modules/preferences/document-analysis/document-analysis.resolver.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/document-analysis/document-analysis.resolver.ts)

Services:

- [`apps/backend/src/modules/preferences/preference/preference.service.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference/preference.service.ts)
- [`apps/backend/src/modules/preferences/preference-definition/preference-definition.service.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference-definition/preference-definition.service.ts)

Repositories:

- [`apps/backend/src/modules/preferences/preference/preference.repository.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference/preference.repository.ts)
- [`apps/backend/src/modules/preferences/preference-definition/preference-definition.repository.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference-definition/preference-definition.repository.ts)

Modules:

- [`apps/backend/src/modules/preferences/preference/preference.module.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference/preference.module.ts)
- [`apps/backend/src/modules/preferences/preference-definition/preference-definition.module.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/preference-definition/preference-definition.module.ts)

MCP entrypoints:

- [`apps/backend/src/mcp/tools/preference-mutation.tool.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/tools/preference-mutation.tool.ts)
- [`apps/backend/src/mcp/tools/preference-definition.tool.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/mcp/tools/preference-definition.tool.ts)

Supporting types and generated schema:

- [`apps/backend/src/modules/preferences/document-analysis/dto/apply-suggestion.input.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/modules/preferences/document-analysis/dto/apply-suggestion.input.ts)
- [`apps/backend/src/infrastructure/prisma/prisma-models.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/infrastructure/prisma/prisma-models.ts)
- [`apps/backend/src/infrastructure/prisma/generated-client.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/infrastructure/prisma/generated-client.ts)
- [`apps/backend/src/schema.gql`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/src/schema.gql)

## Tests added or updated

Added:

- [`apps/backend/test/integration/preference-audit.repository.spec.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/test/integration/preference-audit.repository.spec.ts)

Updated:

- [`apps/backend/test/integration/preference.repository.spec.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/test/integration/preference.repository.spec.ts)
- [`apps/backend/test/e2e/preferences.e2e-spec.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/test/e2e/preferences.e2e-spec.ts)
- [`apps/backend/test/e2e/document-analysis.e2e-spec.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/test/e2e/document-analysis.e2e-spec.ts)
- [`apps/backend/test/e2e/preference-definition-mutations.e2e-spec.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/test/e2e/preference-definition-mutations.e2e-spec.ts)
- [`apps/backend/test/e2e/mcp.e2e-spec.ts`](/Users/lucasnovak/loyal-agents/context-router/apps/backend/test/e2e/mcp.e2e-spec.ts)

Coverage added in this pass:

- audit event persistence shape and queryability
- snapshot normalization
- repository `beforeState` behavior
- provenance options bag behavior
- GraphQL audit writes for set, suggest, and delete
- semantic accept and reject audit events
- document-analysis provenance, `analysisId` correlation, and partial-success auditing
- preference-definition audit writes
- MCP actor and client-key propagation

## Verification commands run

Checkpoint verification:

- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend test:db:migrate`
- `pnpm --filter backend exec jest test/integration/preference-audit.repository.spec.ts --runInBand`
- `pnpm --filter backend exec jest test/integration/preference.repository.spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts test/e2e/preference-definition-mutations.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/document-analysis.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/preference-definition-mutations.e2e-spec.ts test/e2e/mcp.e2e-spec.ts --runInBand`

Final validation sweep:

- `pnpm --filter backend test:integration`
- `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts test/e2e/document-analysis.e2e-spec.ts test/e2e/preference-definition-mutations.e2e-spec.ts test/e2e/mcp.e2e-spec.ts --runInBand`

## Notes

The new audit log is append-only. It records normalized before and after snapshots, plus mutation provenance, but it does not yet expose any user-facing history or rollback capability.

For the live follow-up state, sequencing, and remaining TODO items, see [`../TODO.md`](../TODO.md).
