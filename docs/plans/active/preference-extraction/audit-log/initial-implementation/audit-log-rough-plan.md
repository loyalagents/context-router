# Rough Plan: Preference Audit Log And Provenance Groundwork

## Background

We want to move the preference system toward fuller automation:

- machine-written preferences should stay labeled as machine-written
- preference and definition changes should be auditable
- future full-auto flows should be able to create or modify values and definitions without losing provenance

The current implementation is good at review-before-apply, but weak at long-lived provenance:

- MCP writes are suggestion-first and never write active values directly
- accepted suggestions are promoted to `ACTIVE` and the original `SUGGESTED` row is deleted
- active writes currently stamp `sourceType: USER` in the repository layer
- definition mutations do not have a dedicated history trail

That is acceptable for the current human-in-the-loop model, but it is not a strong enough foundation for future full-auto writes.

## Why This Work Exists

This groundwork is meant to support future design directions without locking them in yet:

- a future single tool or workflow that can create missing definitions and write values
- richer permission models for suggest/write/define behavior
- optional full-auto writes for values and definitions
- better rollback, debugging, and trust-building when the machine makes many changes

This document is intentionally focused on the audit and provenance foundation, not the final full-auto tool contract.

## Current Repo Constraints

Relevant current code paths:

- `apps/backend/src/modules/preferences/preference/preference.service.ts`
- `apps/backend/src/modules/preferences/preference/preference.repository.ts`
- `apps/backend/src/modules/preferences/preference-definition/preference-definition.service.ts`
- `apps/backend/src/mcp/tools/preference-mutation.tool.ts`
- `apps/backend/src/mcp/tools/preference-definition.tool.ts`

Important current behaviors:

- `setPreference()` resolves a slug, validates value/scope, and upserts an active preference
- `suggestPreference()` resolves a slug, validates value/scope, and upserts a suggested preference
- `acceptSuggestion()` promotes to active and deletes the suggested row
- `rejectSuggestion()` creates or refreshes a rejected row and deletes the suggested row
- `createPreferenceDefinition()` creates a user-owned definition, but there is no dedicated audit trail for it

## Goals

- Preserve actor provenance for both value mutations and definition mutations.
- Add an append-only history that survives row replacement, suggestion deletion, and future full-auto writes.
- Make the groundwork useful before full-auto is enabled.
- Keep the live preference/definition tables readable and focused on current state.
- Provide enough structure that a later agent can flesh out a real implementation plan without re-discovering the context.

## Non-Goals For The Groundwork PR

- Do not finalize the full-auto MCP endpoint design here.
- Do not finalize the permission split between suggest/write/define here.
- Do not build a polished audit-log UI here.
- Do not require full rollback UX in the first pass.
- Do not block future schema decisions by overfitting the first audit schema.

## Rough Direction

### 1. Add an append-only audit/event table

The current system stores state, not history. We likely need a dedicated log table rather than trying to reconstruct history from the current rows.

Rough shape:

- one append-only table for preference and definition mutations
- JSON snapshots for `before` and `after`
- enough actor metadata to distinguish user, MCP client, workflow, system, and future auto modes

Possible table shape:

- `id`
- `userId`
- `occurredAt`
- `actorType`
- `actorClientKey`
- `actorLabel`
- `operationType`
- `targetType`
- `slug`
- `namespace`
- `definitionId`
- `preferenceId`
- `beforeState`
- `afterState`
- `metadata`
- `correlationId`

This is intentionally rough. The exact schema still needs design.

### 2. Treat provenance as first-class in service calls

Today the service and repository APIs are optimized for the current state machine, not for long-lived provenance.

We likely want a shared mutation context object that can be passed through GraphQL and MCP flows, for example:

- `actorType`
- `clientKey`
- `mode`
- `confidence`
- `evidence`
- `reason`
- `correlationId`

This would let the same underlying service record:

- a human GraphQL write
- an MCP suggestion
- a future auto write
- a future definition mutation performed as part of a larger flow

### 3. Stop relying on live rows as the only provenance source

The live tables should still capture useful current-state provenance, but the audit log should become the durable source of history.

The groundwork should likely revisit at least these behaviors:

- active machine-authored writes should not always become `sourceType: USER`
- suggestion acceptance should remain auditable after the suggestion row is gone
- definition changes should be traceable even if a definition is updated many times

### 4. Cover both preferences and definitions from day one

Even if the first production use is value writes, the audit model should include definition mutations now.

Reason:

- future full-auto work likely spans both values and definitions
- a half-solution that only covers values will force awkward follow-up schema changes
- the open design questions around full-auto are specifically pushing toward combined value + definition flows

## Suggested Event Taxonomy

This is a starting point, not a final decision.

Preference-side events could include:

- `PREFERENCE_SET_ACTIVE`
- `PREFERENCE_SUGGESTED`
- `PREFERENCE_SUGGESTION_ACCEPTED`
- `PREFERENCE_SUGGESTION_REJECTED`
- `PREFERENCE_DELETED`

Definition-side events could include:

- `DEFINITION_CREATED`
- `DEFINITION_UPDATED`
- `DEFINITION_ARCHIVED`

Open question:

- whether accept/reject should be logged as one semantic event, two lower-level row events, or both

## Questions Another Agent Should Flush Out

- Should this be one audit table or separate tables for preferences vs definitions?
- Should the log store full snapshots, compact diffs, or both?
- Should `beforeState` and `afterState` be raw DB shapes, enriched shapes, or normalized audit shapes?
- What provenance must stay on the live preference row versus only in the audit log?
- Should the groundwork include a read/query surface for audit records, or just persistence and tests?
- How should correlation work for multi-step flows such as “create definition then write preference”?
- Should document-analysis apply flows log one batch correlation id per upload/apply run?
- Should definition mutation logs include namespace changes and ownership changes explicitly even if they are rare?

## Rough Implementation Shape

### Checkpoint 1: lock the minimal audit scope

Decide the smallest useful event model that still supports future full-auto work:

- one append-only table
- both preference and definition mutations covered
- actor metadata included
- correlation id included

Validation:

- short design review on schema and event names before code is written

### Checkpoint 2: add schema and repository plumbing

Add the audit persistence layer without changing product behavior yet.

Possible work:

- Prisma model and migration
- repository or service for writing audit entries
- basic tests for persistence shape

Validation:

- targeted integration tests for audit persistence only

### Checkpoint 3: log existing preference mutations

Hook audit writes into current preference flows:

- `setPreference`
- `suggestPreference`
- `acceptSuggestion`
- `rejectSuggestion`
- `deletePreference`

Validation:

- targeted tests for each mutation path
- verify events are appended with correct actor and slug metadata

### Checkpoint 4: log definition mutations

Hook audit writes into:

- `createPreferenceDefinition`
- `updatePreferenceDefinition`
- `archivePreferenceDefinition`

Validation:

- targeted tests for each definition mutation path

### Checkpoint 5: fix provenance leakage on active writes

Revisit the current behavior where active writes are stamped as `USER`.

This checkpoint may require:

- changing repository method signatures
- adding a current-state actor or source model
- carrying confidence/evidence into machine-authored active rows

Validation:

- targeted tests showing machine-authored active values remain distinguishable from user-authored active values

## Validation Plan

Targeted backend verification should happen after each checkpoint.

Possible commands:

- `pnpm --filter backend exec jest test/e2e/preferences.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/preference-definition-mutations.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/document-analysis.e2e-spec.ts --runInBand`
- add dedicated audit-focused integration or e2e tests once the shape is clearer

Manual verification ideas:

- create a definition, update it, and archive it; verify audit rows are appended
- suggest a preference, accept it, reject another, and delete one; verify all events exist
- confirm actor metadata differs between GraphQL user writes and MCP writes

## Recommended PR Sequencing

Preferred order:

1. Audit/provenance groundwork
2. Full-auto or higher-power write flows that depend on it

Avoid:

1. shipping full-auto active writes first
2. adding audit later after provenance has already been lost in real usage

## Relationship To The Full-Auto Discussion

This groundwork is intentionally upstream of the full-auto design.

The full-auto design still needs more discussion on:

- MCP endpoint shape
- permission model
- whether one tool should handle suggest/write/define behavior
- whether agents should be able to voluntarily lower their own power per task

See:

- `docs/preference-extraction/full-auto/brainstorming-notes.md`
