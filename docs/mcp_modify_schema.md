# MCP Definition Management — Implementation Progress

## Status: Complete ✓

All 3 checkpoints implemented and verified. 208/208 tests passing.

---

## Changes Made

### Checkpoint 1 — Fix `listPreferenceSlugs` user-awareness
**Files changed:**
- `src/mcp/tools/preference-list.tool.ts` — added optional `context?: McpContext` param to `list()`; passes `context?.user?.userId` to `defRepo.getAll()` and `defRepo.getAllCategories()`. Falls back to global-only when no context.
- `src/mcp/mcp.service.ts` — passes `context` to `preferenceListTool.list()`.

### Checkpoint 2 — Add `createPreferenceDefinition` MCP tool
**Files changed:**
- `src/mcp/tools/preference-definition.tool.ts` (new) — wraps `PreferenceDefinitionService.create`. Boundary validates `valueType` and `scope` against allowed enums before calling the service (bad values → `INVALID_PREFERENCE_DEFINITION`). Handles `options` validation (ENUM requires non-empty string array; non-ENUM rejects `options`). Maps Prisma P2002 unique constraint violations (race condition duplicates) to `PREFERENCE_DEFINITION_CONFLICT`. Returns normalized shape with `visibility: "USER"`. Error codes: `INVALID_PREFERENCE_DEFINITION`, `PREFERENCE_DEFINITION_CONFLICT`, `INTERNAL_ERROR`.
- `src/modules/preferences/preference-definition/preference-definition.module.ts` — exported `PreferenceDefinitionService`.
- `src/mcp/mcp.module.ts` — added `PreferenceDefinitionTool` as provider.
- `src/mcp/mcp.service.ts` — injected `PreferenceDefinitionTool`; registered tool in `ListTools`; added `case 'createPreferenceDefinition':` to dispatch.

### Checkpoint 3 — Structured error guidance in `suggestPreference`
**Files changed:**
- `src/mcp/tools/preference-mutation.tool.ts` — detects `Unknown preference slug` in caught errors and returns `{ success: false, error, code: 'UNKNOWN_PREFERENCE_SLUG', message, suggestedTool: 'createPreferenceDefinition' }`. The `error` field is preserved for backward compatibility with existing clients.

### Tests
**File changed:**
- `test/e2e/mcp.e2e-spec.ts` — added 11 new tests covering all plan items.

Also fixed pre-existing issue: Prisma client needed regeneration (`npx prisma generate`) to pick up the `ExternalIdentity` model — auth.service.ts TS errors were from stale generated client.

---

## Test Results

```
Test Suites: 13 passed, 13 total
Tests:       208 passed, 208 total
```

---

## MCP Tool Surface (after this change)

| Tool | Auth | Description |
|------|------|-------------|
| `listPreferenceSlugs` | Required | Lists GLOBAL + user-owned defs for the authenticated user |
| `searchPreferences` | Required | Searches user's active/suggested preferences |
| `suggestPreference` | Required | Suggests a preference value; returns structured guidance if slug unknown |
| `deletePreference` | Required | Deletes a preference by ID |
| `createPreferenceDefinition` | Required | Creates a user-owned definition for a new slug |

---

## Phase 2 (Future)

`updatePreferenceDefinition` — metadata-only fields (`displayName`, `description`, `isSensitive`). Implement only once real edit demand is observed.
