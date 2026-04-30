# Full-Auto MCP Mutation Pre-Implementation Summary

- Status: superseded-by-implementation
- Read when: implementing direct MCP preference writes, MCP definition mutation, or full-auto preference extraction
- Source of truth: superseded by `implementation-summary.md` and the shipped code in `apps/backend/src/mcp/**`, `apps/backend/src/modules/preferences/**`, and `apps/backend/prisma/schema.prisma`
- Last reviewed: 2026-04-22

This file captures the pre-implementation design discussion. The implemented behavior is documented in `docs/plans/active/preference-extraction/full-auto/implementation-summary.md`.

## Context

The current MCP mutation surface is review-first:

- `suggestPreference` writes `SUGGESTED` rows only.
- `createPreferenceDefinition` can create user-owned definitions.
- active preference writes are available through GraphQL service paths, not MCP.
- definition update/archive are available through GraphQL service paths, not MCP.
- MCP permission grants only distinguish `READ` and `WRITE`.

For the demo, backward compatibility and data migrations are not a constraint. There are no active consumers that need the current MCP mutation contract preserved. This lets the implementation prioritize a cleaner MCP shape over incremental compatibility.

## Product Goal

Expose a single MCP mutation tool that lets an agent manually:

- suggest preference values
- write active preference values directly
- create user-owned preference definitions
- update user-owned preference definitions
- archive user-owned preference definitions

The tool should avoid forcing agents through a suggestion-only workflow when the user or demo setup has granted stronger permissions.

## Permission Model

Replace the current MCP mutation permission model with four explicit actions:

- `READ`
- `SUGGEST`
- `WRITE`
- `DEFINE`

Intended meaning:

- `READ`: inspect preference definitions, preferences, permission grants, schema, and read-only workflow outputs.
- `SUGGEST`: write `SUGGESTED` preference rows that require later acceptance.
- `WRITE`: write `ACTIVE` preference rows directly.
- `DEFINE`: create, update, or archive user-owned preference definitions.

This should be reflected consistently across:

- Prisma `GrantAction`
- MCP capability strings
- MCP client config
- OAuth scopes
- target grant evaluation
- permission dashboard GraphQL types and generated frontend types if the UI remains in scope

For the demo-capable clients, grant all four capabilities by default unless a specific test is checking narrower behavior.

## New MCP Tool

Add one new MCP tool, tentatively named:

```text
mutatePreferences
```

The tool should be operation-based. One public tool keeps the MCP tool list smaller, while the operation discriminator keeps semantics explicit.

Candidate operation set:

```text
SUGGEST_PREFERENCE
SET_PREFERENCE
CREATE_DEFINITION
UPDATE_DEFINITION
ARCHIVE_DEFINITION
```

Initial input shape:

```json
{
  "operation": "SET_PREFERENCE",
  "preference": {
    "slug": "system.response_tone",
    "value": "\"concise\"",
    "locationId": null,
    "confidence": 0.9,
    "evidence": "{\"reason\":\"User asked for concise replies\"}"
  },
  "definition": {
    "id": "optional-definition-id",
    "slug": "system.response_tone",
    "displayName": "Response Tone",
    "description": "Preferred response tone",
    "valueType": "ENUM",
    "scope": "GLOBAL",
    "options": ["concise", "friendly", "technical"],
    "isSensitive": false
  }
}
```

Notes:

- Preference `value` should remain a JSON string for MCP compatibility with the existing tool style.
- Preference `evidence` should remain a JSON string when supplied.
- `confidence` is required for `SUGGEST_PREFERENCE`; for `SET_PREFERENCE`, it should be optional but allowed so machine-written active rows can keep confidence metadata.
- `UPDATE_DEFINITION` should support lookup by `id` or by `slug`; slug-based update is better for agents in a demo.
- `ARCHIVE_DEFINITION` should support lookup by `id` or by `slug`.

## Operation Semantics

### `SUGGEST_PREFERENCE`

Requires `SUGGEST` for the target slug.

Calls the existing suggestion service path and writes a `SUGGESTED` preference. It should preserve the existing rejected-suggestion suppression behavior unless a later design explicitly changes it.

### `SET_PREFERENCE`

Requires `WRITE` for the target slug.

Calls the existing active write service path. For MCP-originated writes:

- `actorType`: `MCP_CLIENT`
- `origin`: `MCP`
- `actorClientKey`: calling MCP client key
- `sourceType`: likely `INFERRED`
- `confidence`: optional from input
- `evidence`: optional from input

The result should remain visibly machine-written through the existing preference provenance fields and audit log.

### `CREATE_DEFINITION`

Requires `DEFINE` for the target slug.

Creates a user-owned definition using the existing definition service path. It should reject collisions with live global definitions and live user-owned definitions under the existing service rules.

### `UPDATE_DEFINITION`

Requires `DEFINE` for the target slug.

Updates only user-owned definitions for the authenticated user. It should reject:

- global definitions
- definitions owned by another user
- archived definitions unless a later design explicitly supports restoring or editing archived definitions

Shape-changing updates are higher risk:

- `valueType`
- `scope`
- `options`

For the first implementation, it is acceptable to allow them because this is demo-focused, but tests should cover that existing service behavior remains coherent. If this gets productized later, shape-changing updates should likely become stricter.

### `ARCHIVE_DEFINITION`

Requires `DEFINE` for the target slug.

Archives only user-owned definitions for the authenticated user. Existing preferences that point at the definition should follow current backend behavior unless the implementation discovers a service-level issue that must be addressed.

## Deferred Convenience Operation

Do not start with automatic definition creation during `SET_PREFERENCE`.

In the first implementation:

- `SET_PREFERENCE` requires an existing slug.
- `CREATE_DEFINITION` is a separate operation inside the same tool.
- The agent can call `mutatePreferences` twice when it needs to define then set.

A later operation can be added:

```text
UPSERT_DEFINITION_AND_SET_PREFERENCE
```

That operation would require both `DEFINE` and `WRITE`. It should be implemented only after the explicit operations are green, because it introduces multi-step authorization, transactional semantics, and multi-event audit questions.

## Response Shape

Every operation should return a predictable envelope:

```json
{
  "success": true,
  "operation": "SET_PREFERENCE",
  "requiredPermission": "WRITE",
  "target": "system.response_tone",
  "changed": true,
  "preference": {
    "id": "preference-id",
    "slug": "system.response_tone",
    "value": "concise",
    "status": "ACTIVE",
    "sourceType": "INFERRED",
    "confidence": 0.9
  },
  "definition": null,
  "audit": {
    "origin": "MCP",
    "actorClientKey": "codex",
    "correlationId": "correlation-id"
  }
}
```

Failures should be structured enough for agents to recover:

```json
{
  "success": false,
  "operation": "CREATE_DEFINITION",
  "code": "MCP_PERMISSION_DENIED",
  "requiredPermission": "DEFINE",
  "target": "food.secret_sauce",
  "error": "Client \"codex\" is not allowed to define preferences for this target"
}
```

Useful error codes:

- `MCP_PERMISSION_DENIED`
- `INVALID_MUTATION_OPERATION`
- `INVALID_PREFERENCE_VALUE`
- `UNKNOWN_PREFERENCE_SLUG`
- `INVALID_PREFERENCE_DEFINITION`
- `PREFERENCE_DEFINITION_CONFLICT`
- `PREFERENCE_DEFINITION_NOT_FOUND`
- `PREFERENCE_DEFINITION_NOT_OWNED`
- `INTERNAL_ERROR`

## What To Do With Existing Tools

For the demo, prefer registering the new tool as the main mutation surface.

Options:

- keep old mutation tool classes in code but remove `suggestPreference`, `createPreferenceDefinition`, and `deletePreference` from the MCP tool registry
- or leave `suggestPreference` registered briefly for comparison while demo clients are moved to `mutatePreferences`

The cleaner demo surface is:

- read/search tools
- workflow tools
- `mutatePreferences`
- permission grant list tool
- schema resource

## Checkpoints

### Checkpoint 1: Four-action permissions

Implement and verify:

- Prisma `GrantAction`: `READ`, `SUGGEST`, `WRITE`, `DEFINE`
- MCP capabilities: `preferences:read`, `preferences:suggest`, `preferences:write`, `preferences:define`
- authorization mapping from tool required access to capability
- target grant evaluation for all four actions
- client config and OAuth scope updates
- tests proving one denied action does not deny a different action for the same slug

Targeted tests:

- permission grant unit/integration tests
- MCP e2e tests for tools/list visibility and target denials
- dashboard permission tests only if the UI is updated in the same checkpoint

### Checkpoint 2: `mutatePreferences` explicit operations

Implement and verify:

- `SUGGEST_PREFERENCE`
- `SET_PREFERENCE`
- `CREATE_DEFINITION`
- `UPDATE_DEFINITION`
- `ARCHIVE_DEFINITION`
- shared JSON parsing for preference values and evidence
- shared mutation context construction for MCP provenance
- operation-specific permission checks
- structured response envelope and error codes

Targeted tests:

- MCP e2e success path for each operation
- MCP e2e permission denial for each operation
- audit rows for active write and definition mutations
- user isolation for definition update/archive
- validation errors for invalid values and invalid definitions

### Checkpoint 3: Tool registry cleanup

Implement and verify:

- expose the desired demo tool list
- remove or hide old mutation tools from `MCP_TOOLS` if appropriate
- update docs for current MCP authorization and schema behavior
- update any local setup notes only if the developer workflow changes

Targeted tests:

- `tools/list` includes `mutatePreferences`
- `tools/list` excludes old mutation tools if removed from the registry
- existing read tools remain visible under `READ`

### Later: Combined full-auto operation

Consider adding:

```text
UPSERT_DEFINITION_AND_SET_PREFERENCE
```

Only after explicit operations are stable.

Open design decisions for this later step:

- whether create-definition plus set-preference should be one DB transaction
- whether to emit one semantic audit event, multiple low-level audit events, or both
- how partial failure should be represented
- whether definition update should be allowed as part of a combined value write

## Implementation Notes

Prefer reusing existing domain services rather than writing directly through Prisma:

- `PreferenceService.setPreference`
- `PreferenceService.suggestPreference`
- `PreferenceDefinitionService.create`
- `PreferenceDefinitionService.update`
- `PreferenceDefinitionService.archiveDefinition`

If slug-based definition update/archive is added, implement a small resolver helper that:

1. looks up the visible user/global definition by slug
2. requires it to be user-owned by the authenticated user
3. returns the definition id for the existing service method

Keep audit correlation consistent by using the MCP dispatch correlation id already placed on `McpContext`.

## Risks

- A single tool can become too broad unless operation-level permissions and response errors stay explicit.
- Changing definition `valueType`, `scope`, or `options` can invalidate existing preference rows.
- `DEFINE` grants are slug-based, so permissions still do not distinguish global and user-owned namespaces.
- If old mutation tools remain registered, models may still choose them and bypass the cleaner demo path.
- MCP access logs currently exclude write tools; mutation audit logs cover writes, but request-level MCP write call history will still be absent unless that logging policy changes.

## Current Recommendation

Proceed with:

1. four-action permission model
2. one operation-based `mutatePreferences` MCP tool
3. explicit operations first, no automatic define-and-set in the first pass
4. hide old mutation tools from the demo registry once the new tool is green

This gives the demo a small MCP surface while preserving clear internal authorization and audit semantics.
