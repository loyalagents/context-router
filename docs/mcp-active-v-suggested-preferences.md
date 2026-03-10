# MCP Active vs Suggested Preferences

## Summary

This workshop branch supports two explicit MCP preference write flows:

- `suggestPreference` for review-first writes
- `applyPreference` for direct no-UI writes

The backend keeps both flows explicit rather than overloading one tool with a mode flag. That keeps agent behavior clearer and preserves separate semantics for reviewable suggestions versus direct active writes.

## Chosen Design

### MCP write tools

- Keep `suggestPreference` as the existing review-first tool.
- Add `applyPreference` as a new MCP tool for direct active writes.
- Do not add an MCP `acceptSuggestedPreference`-style tool in this slice.

### Confidence semantics

- `confidence` is required on `applyPreference` for symmetry with `suggestPreference`.
- On `applyPreference`, `confidence` is informational only.
- The server stores it for provenance and auditability.
- The server does not use `confidence` as an allow/deny threshold for direct apply in this workshop branch.

### Provenance rules

- `suggestPreference` creates `SUGGESTED` rows with `sourceType=INFERRED`.
- `applyPreference` creates or updates `ACTIVE` rows with `sourceType=AGENT`.
- Manual GraphQL `setPreference` continues to create or update `ACTIVE` rows with `sourceType=USER`.
- Accepting a suggestion should produce an `ACTIVE` row with `sourceType=AGENT` and carry forward any `confidence` and `evidence` from the suggestion.
- If a human later overwrites an AGENT-authored active preference via `setPreference`, that write should convert the row to `sourceType=USER` and clear stale AI-only metadata (`confidence`, `evidence`).

### Rejected-history blocking

- Direct apply must check for an existing persisted `REJECTED` row for the same user, resolved definition, and scope.
- If a matching rejection exists, direct apply is blocked.
- The MCP response should be explicit and structured, using a business-rule code such as `PREFERENCE_REJECTED`.
- The returned message should make it clear that the user previously rejected this preference for that same scope.

The system can make this decision because rejected suggestions are already stored durably in the preferences table with `status=REJECTED`.

### Suggestion cleanup on direct apply

- After a successful `applyPreference`, delete any matching pending `SUGGESTED` row for the same user, definition, and scope.
- This avoids an `ACTIVE` preference plus a stale inbox item representing the same preference.

This branch does not currently model reviewer assignment or in-progress review ownership for suggestion inbox items, so this cleanup does not interrupt a separate reviewer workflow.

### Existing data policy

- Leave existing `SUGGESTED` and `REJECTED` rows with `sourceType=INFERRED` unchanged.
- Do not backfill existing data.
- Current code does not intentionally create `ACTIVE` rows with `sourceType=INFERRED`, so no active-row migration or cleanup is expected.

### Trust policy

- For the workshop branch, direct apply is available to all authenticated MCP callers.
- After the workshop, this should likely tighten to an explicit trusted-agent or policy-based allowlist.

## Why Two Tools

### Pros

- Tool names carry intent directly for the agent.
- The contract stays explicit: review-first versus direct-apply.
- The backend can keep separate business rules without overloading one mutation shape.
- Testing and documentation stay clearer.

### Cons

- Agents see one more tool in `tools/list`.
- Client wrappers may still choose to present a higher-level single “write preference” capability on top of the two-tool contract.

## Request and Response Shape

### `suggestPreference`

Request shape stays unchanged:

```json
{
  "slug": "system.response_tone",
  "value": "\"professional\"",
  "confidence": 0.9,
  "locationId": "optional-location-id",
  "evidence": "{\"reason\":\"Mentioned in chat\"}"
}
```

### `applyPreference`

Request shape mirrors `suggestPreference`:

```json
{
  "slug": "system.response_tone",
  "value": "\"professional\"",
  "confidence": 0.9,
  "locationId": "optional-location-id",
  "evidence": "{\"reason\":\"Agent applied directly\"}"
}
```

Expected success shape:

```json
{
  "success": true,
  "clearedSuggestion": true,
  "preference": {
    "id": "preference-id",
    "slug": "system.response_tone",
    "value": "professional",
    "status": "ACTIVE",
    "sourceType": "AGENT",
    "confidence": 0.9,
    "locationId": null,
    "category": "system",
    "description": "How the assistant should respond"
  }
}
```

Expected rejected-history block shape:

```json
{
  "success": false,
  "code": "PREFERENCE_REJECTED",
  "error": "Preference was previously rejected for this scope",
  "message": "Direct apply blocked because the user previously rejected preference \"system.response_tone\" for this scope."
}
```

Unknown-slug and validation failures should follow the existing MCP error style used by preference mutation tools.

For unknown slugs, `applyPreference` should return the same structured MCP guidance style already used by `suggestPreference`, including `code: "UNKNOWN_PREFERENCE_SLUG"` and `suggestedTool: "createPreferenceDefinition"` when applicable.

## Checkpoint Log

### 2026-03-10 - Checkpoint 0 - baseline

- Decision: implement two explicit MCP write tools for the workshop branch, `suggestPreference` and `applyPreference`, with `AGENT` provenance for direct active writes.
- Environment setup required before running the baseline suites in this worktree:
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter backend prisma:generate`
  - `pnpm --filter backend test:db:migrate`
- Baseline test result: `FAIL` before feature implementation.
- Requested baseline suites:
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/preferences.e2e-spec.ts`
    - Result: `9 failed, 3 passed, 12 total`
    - Representative failures:
      - `Foreign key constraint violated on the constraint: user_preferences_user_id_fkey`
      - `Unique constraint failed on the fields: (email)` in `test/setup/test-app.ts`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/mcp.e2e-spec.ts`
    - Result: `9 failed, 17 passed, 26 total`
    - Representative failures:
      - `Foreign key constraint violated on the constraint: user_preferences_user_id_fkey`
      - `Unique constraint failed on the fields: (email)` in `test/setup/test-app.ts`
- Interpretation:
  - The requested suites were not green on the current branch before this feature work.
  - Those failures were treated as pre-existing baseline issues unless the implementation touched the same harness paths.

### 2026-03-10 - Checkpoint 1 - provenance and active-write semantics

- Implemented:
  - added `SourceType.AGENT` in Prisma and GraphQL surfaces
  - refactored active upsert behavior so active rows can preserve explicit provenance plus optional `confidence` and `evidence`
  - manual `setPreference` still writes `USER` and clears stale AI metadata on overwrite
  - `acceptSuggestedPreference` now promotes to `ACTIVE` with `sourceType=AGENT` and carries forward `confidence` and `evidence`
  - added repository helper support for deleting matching suggestion rows by user + definition + scope
- Targeted tests run:
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects integration --runInBand test/integration/preference.repository.spec.ts`
    - Result: `PASS`
    - Summary: `34 passed, 34 total`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/preferences.e2e-spec.ts -t "should create a global preference"`
    - Result: `PASS`
    - Summary: `1 passed, 11 skipped`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/preferences.e2e-spec.ts -t "should promote a suggested preference to ACTIVE with AGENT provenance"`
    - Result: `PASS`
    - Summary: `1 passed, 11 skipped`

### 2026-03-10 - Checkpoint 2 - MCP direct apply

- Implemented:
  - added MCP `applyPreference`
  - direct apply reuses existing slug/value/scope/location validation
  - direct apply blocks on persisted rejected history and returns structured `PREFERENCE_REJECTED`
  - direct apply writes `ACTIVE` rows with `sourceType=AGENT`
  - direct apply clears a matching pending suggestion after success
  - updated this design note with finalized request/response examples, including `clearedSuggestion`
- Targeted tests run:
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/mcp.e2e-spec.ts -t "lists the supported MCP tools"`
    - Result: `PASS`
    - Summary: `1 passed, 29 skipped`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/mcp.e2e-spec.ts -t "can apply a preference directly as ACTIVE with AGENT provenance"`
    - Result: `PASS`
    - Summary: `1 passed, 29 skipped`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/mcp.e2e-spec.ts -t "can apply a location-scoped preference directly"`
    - Result: `PASS`
    - Summary: `1 passed, 29 skipped`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/mcp.e2e-spec.ts -t "blocks applyPreference when the user previously rejected the same preference for this scope"`
    - Result: `PASS`
    - Summary: `1 passed, 29 skipped`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/mcp.e2e-spec.ts -t "clears a matching pending suggestion after direct apply"`
    - Result: `PASS`
    - Summary: `1 passed, 29 skipped`

### 2026-03-10 - Checkpoint 3 - UI compatibility and final regression

- Implemented:
  - active preference UI now recognizes `sourceType=AGENT` and renders an `Agent` badge
  - suggestion inbox remains unchanged and still keys off `sourceType=INFERRED`
- Final regression commands run:
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects integration --runInBand test/integration/preference.repository.spec.ts`
    - Result: `PASS`
    - Summary: `34 passed, 34 total`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/preferences.e2e-spec.ts`
    - Result: `PASS`
    - Summary: `12 passed, 12 total`
  - `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/mcp.e2e-spec.ts`
    - Result: `PASS`
    - Summary: `30 passed, 30 total`
- Frontend verification:
  - `pnpm --filter web build`
    - Result: `PASS`
    - Notes:
      - GraphQL codegen completed successfully against the updated schema.
      - Next.js production build completed successfully.
      - Existing warning still present in `apps/web/app/dashboard/preferences/components/DocumentUpload.tsx:110` about an unnecessary `useCallback` dependency on `accessToken`.
