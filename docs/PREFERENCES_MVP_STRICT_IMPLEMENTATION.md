# Strict Code-First Preferences (Slug + Suggestion Workflow) — Implementation Guide

This document is written for an LLM coding agent to implement the MVP **end-to-end** in this repo.

---

## 0) Context (Repo orientation)

Relevant areas in the repo (based on current structure):

- **Backend (NestJS + GraphQL + Prisma)**
  - `apps/backend/prisma/schema.prisma` — Prisma schema + migrations
  - `apps/backend/src/modules/preferences/` — preference module (resolver/service/repository/models/dto)
  - `apps/backend/src/mcp/tools/` — MCP tools:
    - `preference-mutation.tool.ts`
    - `preference-search.tool.ts`

- **Web (Next.js)**
  - `apps/web/app/dashboard/preferences/` — preferences UI:
    - `PreferencesClient.tsx`, `PreferenceItem.tsx`, `SuggestionItem.tsx`, etc.

---

## 1) MVP Goal

Implement a **simple, strict, LLM-safe** preference system:

### Core pillars
1. **Canonical slugs** replace category/key  
   Example: `food.dietary_restrictions`, `system.response_tone`

2. **Suggestion-first workflow** (state machine):
   - `ACTIVE` = confirmed truth (used in context)
   - `SUGGESTED` = inferred guess (review inbox)
   - `REJECTED` = rejected/ignored

3. **Provenance for every row**:
   - `sourceType` (`USER | INFERRED | IMPORTED | SYSTEM`)
   - `confidence` (required for `INFERRED`)
   - `evidence` (JSON blob with loose schema — see below)

4. **Strict code-first registry**:
   - A TypeScript catalog defines all valid slugs, descriptions, types, and scope.
   - **Unknown slugs are rejected** (to prevent drift).

5. **Single-table storage**:
   - Keep it lean: one table stores both `ACTIVE` and `SUGGESTED` rows via `status`.
   - No `PreferenceDefinition` DB table in MVP.

### Explicit non-goals for MVP
- No DB-backed registry / admin UI
- No vector search / embeddings
- No full audit/event sourcing (future enhancement)
- No backward compatibility: **drop** existing `category` and `key` columns now

---

## 2) Data Model (Prisma)

### 2.1 Enums
Add these enums to `apps/backend/prisma/schema.prisma`:

```prisma
enum PreferenceStatus {
  ACTIVE
  SUGGESTED
  REJECTED
}

enum SourceType {
  USER
  INFERRED
  IMPORTED
  SYSTEM
}
```

### 2.2 Table model

**Important**: Prefer *minimal churn*:
- If you currently have a `preferences` Prisma model/table, update that model rather than introducing a brand new model name unless renaming is trivial.
- The key change is: identity is `slug` and **category/key columns are removed**.

Target model (name can be `Preference` or `UserPreference`—pick whichever causes fewer renames):

```prisma
model UserPreference {
  id          String           @id @default(uuid())
  userId      String
  locationId  String?

  slug        String
  value       Json

  status      PreferenceStatus @default(ACTIVE)
  sourceType  SourceType       @default(USER)
  confidence  Float?
  evidence    Json?            // See Evidence schema below

  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  // For location-specific prefs: one row per (user, location, slug, status)
  @@unique([userId, locationId, slug, status])
  @@index([userId, locationId])
  @@index([slug])

  @@map("user_preferences")
}
```

**IMPORTANT: Partial index for global preferences**

Postgres treats NULL as "not equal" in UNIQUE constraints, so `@@unique([userId, locationId, slug, status])` does NOT prevent duplicate global prefs (where `locationId IS NULL`).

Add this partial unique index in the migration SQL after Prisma creates the table:

```sql
CREATE UNIQUE INDEX "user_preferences_global_unique"
ON "user_preferences" ("userId", "slug", "status")
WHERE "locationId" IS NULL;
```

### 2.3 Evidence schema (loose TypeScript interface)
The `evidence` field stores provenance metadata as JSON. Use this loose schema as guidance:

```ts
// apps/backend/src/config/preferences.catalog.ts (or separate types file)
export interface PreferenceEvidence {
  messageIds?: string[];      // IDs of messages that led to this inference
  snippets?: string[];        // Relevant text snippets from the conversation
  modelVersion?: string;      // Model that made the inference (e.g., "gpt-4o")
  inferredAt?: string;        // ISO timestamp of when inference was made
  reason?: string;            // Brief explanation of why this was inferred
}
```

This is not strictly validated in MVP — just a guideline for consistency.

### 2.4 DB constraints & invariants (enforced in service layer)
- Slug must match regex: `^[a-z]+(\.[a-z0-9_]+)+$`
- Slug must exist in the code registry
- If `sourceType = INFERRED`, then `confidence` must be present in `[0,1]`
- Scope enforcement (registry-driven):
  - `global` → `locationId` must be null
  - `location` → `locationId` required

### 2.5 Migration strategy (no active users)
**DECISION: Drop and recreate table** (simplicity over backwards compatibility)

Steps:
1. Update the Prisma schema with the new model
2. Run migration from the backend directory:
   ```bash
   cd apps/backend
   pnpm prisma migrate dev --name slug_suggestion_workflow
   ```
3. After Prisma generates the migration, **manually add** the partial index to the migration SQL:
   ```sql
   -- Partial unique index for global preferences (locationId IS NULL)
   DROP INDEX IF EXISTS "user_preferences_global_unique";
   CREATE UNIQUE INDEX "user_preferences_global_unique"
   ON "user_preferences" ("userId", "slug", "status")
   WHERE "locationId" IS NULL;
   ```
4. Run `pnpm prisma generate` to update Prisma client types

No data migration needed - no active users to preserve.

---

## 3) Code-First Registry (Strict Slug Catalog)

Create:

- `apps/backend/src/config/preferences.catalog.ts`

### 3.1 Catalog types

```ts
export type PreferenceValueType = "string" | "boolean" | "enum" | "array";

export interface PreferenceDefinition {
  category: string;               // UI grouping only (system/food/dev/etc.)
  description: string;            // LLM-facing meaning + how to apply
  valueType: PreferenceValueType;
  options?: string[];             // for enum
  scope: "global" | "location";   // enforce locationId usage
  isSensitive?: boolean;          // future: redact from prompt by default
}

export const PREFERENCE_CATALOG: Record<string /* slug */, PreferenceDefinition> = {
  "system.response_tone": {
    category: "system",
    description: "The personality and formality level the AI should use.",
    valueType: "enum",
    options: ["casual", "professional", "concise", "enthusiastic"],
    scope: "global",
  },
  "food.dietary_restrictions": {
    category: "food",
    description: "Food allergies, dislikes, or diet plans the user follows.",
    valueType: "array",
    scope: "global",
  },
  "dev.tech_stack": {
    category: "dev",
    description: "Preferred programming languages, frameworks, and tools.",
    valueType: "array",
    scope: "global",
  },
};
```

### 3.2 Helper utilities (recommended)
Either in the same file or `apps/backend/src/config/preferences.catalog.utils.ts`:

- `getDefinition(slug)`
- `isKnownSlug(slug)`
- `validateSlugFormat(slug)`
- `validateValue(def, value)`
- `enforceScope(def, locationId)`

Value validation MVP rules:
- `boolean` → `typeof value === "boolean"`
- `string` → `typeof value === "string"`
- `enum` → `typeof value === "string" && def.options.includes(value)`
- `array` → `Array.isArray(value)` (don’t enforce item types yet)

---

## 4) Backend (NestJS + GraphQL) — Required Changes

### 4.1 Update preference domain module

Work under:
- `apps/backend/src/modules/preferences/preference/`

#### Update / create DTOs
Replace category/key inputs with slug-first inputs.

Create/update:
- `dto/set-preference.input.ts`  
  Fields: `slug: string`, `value: any`, `locationId?: string`
- `dto/suggest-preference.input.ts`  
  Fields: `slug: string`, `value: any`, `locationId?: string`, `confidence: number`, `evidence?: any`

#### Update GraphQL model
Update:
- `models/preference.model.ts`
Ensure the GraphQL type exposes at least:
- `id`, `slug`, `value`, `status`, `sourceType`, `confidence`, `evidence`, `locationId`, `updatedAt`

Optional convenience fields (recommended for UI):
- `description` (resolved from catalog at runtime, not stored in DB)
- `category` (from catalog)

#### Update resolver
Update:
- `preference.resolver.ts`

Add these operations (names can align with existing resolver style):

Queries:
- `activePreferences(locationId?: ID): [Preference]`
- `suggestedPreferences(locationId?: ID): [Preference]`

**DECISION: Query scope behavior**
- `activePreferences(locationId: null)` → returns **only global** preferences (where `locationId IS NULL`)
- `activePreferences(locationId: "abc")` → returns **global + that location's** preferences (merged view)
  - **Merged view details:** Returns one row per slug. If a location-specific row exists for a slug, it takes precedence over the global row. The returned row's `locationId` reflects whether it's the global value (null) or the location override (the location ID).

**DECISION: Suggested query returns union (no merging)**
- `suggestedPreferences(locationId: null)` → returns only global suggestions
- `suggestedPreferences(locationId: "abc")` → returns **union** of global + location suggestions (all items, no deduplication)
- Unlike active preferences, we don't merge/dedupe suggestions because the inbox UI should show all pending items transparently

Mutations:
- `setPreference(input): Preference`
  - writes/upserts `status=ACTIVE`, `sourceType=USER`
  - **NOTE:** User writes via `setPreference` ignore any existing REJECTED row — users can always override a previous rejection. The REJECTED check only applies to LLM-inferred suggestions.
- `suggestPreference(input): Preference`
  - writes/upserts `status=SUGGESTED`, `sourceType=INFERRED`
- `acceptSuggestedPreference(id: ID!): Preference`
  - promotes suggested → active
- `rejectSuggestedPreference(id: ID!): Boolean`
  - sets `status=REJECTED`

**DECISION: Delete suggestions on accept, keep REJECTED rows on reject**
- On reject: upsert a `REJECTED` row (create if none exists, or update `updatedAt` if one already exists), then **delete** the `SUGGESTED` row. This is idempotent and handles edge cases cleanly.
- On accept: upsert new `ACTIVE` row with the suggested value, then **delete** the `SUGGESTED` row

This keeps `REJECTED` meaning "user explicitly said no" and avoids uniqueness conflicts.

#### Update service
Update:
- `preference.service.ts`

Implement core methods (names flexible):

- `setActivePreference(userId, locationId?, slug, value)`
- `suggestPreference(userId, locationId?, slug, value, confidence, evidence?)`
- `listByStatus(userId, status, locationId?)`
- `acceptSuggestion(preferenceId, userId)`
- `rejectSuggestion(preferenceId, userId)`

Service logic rules:
- Validate slug exists in catalog (`isKnownSlug`) → else throw error
- Validate slug format
- Enforce scope
- Validate value type
- For inferred writes:
  - **first check if a REJECTED row exists** for `(userId, locationId, slug)` — if yes, return early (no-op or soft error like "previously rejected")
  - require confidence and clamp/validate [0,1]
  - **upsert** suggestion row on compound key `(userId, locationId, slug)` where `status=SUGGESTED` — this means concurrent suggestions for the same slug result in "last write wins" with a single row
  - MUST NOT overwrite `ACTIVE` row (uniqueness includes status so safe)
- For accept:
  - read suggestion row (ensure belongs to user)
  - upsert active row with suggested value
  - set sourceType to `USER` (or a dedicated `INFERRED_ACCEPTED` if you add later—skip for MVP)
  - delete the suggestion row (per decision above)

**DECISION: Array values use REPLACE semantics**
- When a user accepts a suggestion for an `array` type preference, the suggested value **replaces** the existing active value entirely
- No automatic merging of arrays
- Future enhancement: add explicit `appendToPreference` mutation if merge behavior is needed

#### Update repository
Update:
- `preference.repository.ts`
Update upsert/find logic for the new unique constraint `userId + locationId + slug + status`.

---

## 5) MCP Tools — Required Changes

Update files:
- `apps/backend/src/mcp/tools/preference-search.tool.ts`
- `apps/backend/src/mcp/tools/preference-mutation.tool.ts`

### 5.1 preference-search.tool.ts (read)
Behavior:
1. Input: user query string (e.g., "food", "tone", "diet")
2. Search the catalog first:
   - match by slug prefix, category, and description keyword contains
3. Fetch DB rows with `status=ACTIVE` for matching slugs
4. Return to the model:
   - slug
   - short description (from catalog)
   - value (if present)
   - provenance summary (sourceType, updatedAt)

Optional flag (for review flows only):
- include suggestions: fetch `status=SUGGESTED`

### 5.2 preference-mutation.tool.ts (write)
Behavior:
- Input: `{ slug, value, locationId?, confidence?, evidence? }`
- Validate slug exists in catalog (strict). If invalid:
  - throw tool error with helpful message: `Unknown slug "foods.diet". Did you mean "food.dietary_restrictions"?`
  - include list of closest matches or all valid slugs in the error

**DECISION: MCP writes are ALWAYS suggestions**
- All MCP tool writes force `sourceType=INFERRED` and `status=SUGGESTED`
- The `sourceType` parameter is NOT exposed to the LLM (prevents bypassing suggestion workflow)
- Only the web UI (authenticated GraphQL mutations) can write `status=ACTIVE` with `sourceType=USER`
- This ensures humans always review LLM-inferred preferences before they become active
- **REJECTED check:** Before writing, check if a REJECTED row exists for `(userId, locationId, slug)`. If yes, return a message like `"Suggestion skipped: user previously rejected this preference"` (not an error, just a no-op).

### 5.3 preference-list.tool.ts (NEW — catalog discovery)
**NEW TOOL** — Create `apps/backend/src/mcp/tools/preference-list.tool.ts`

Behavior:
- Input: `{ category?: string }` (optional filter)
- Returns all valid slugs from the catalog with:
  - slug
  - category
  - description
  - valueType
  - options (if enum)
  - scope
- This helps the LLM discover what preferences exist before attempting to write

---

## 6) Web UI (Next.js) — Required Changes

Update area:
- `apps/web/app/dashboard/preferences/`

### MVP UI behavior
- Two sections:
  - **Confirmed** preferences: `ACTIVE`
  - **Suggested** inbox: `SUGGESTED`
- Suggested items have:
  - Accept button → `acceptSuggestedPreference(id)`
  - Reject button → `rejectSuggestedPreference(id)`

**UX note for array-type preferences:**
Since array values use REPLACE semantics, accepting a suggestion will overwrite the existing value entirely. For MVP this is acceptable, but consider showing a preview/confirmation for array types (e.g., "This will replace your current list: [vegan, gluten-free] with: [lactose-intolerant]"). This is a UI polish item, not a blocker.

### Data display
- Show `slug`, `value`, and description/category.
- Prefer backend to return `description/category` derived from catalog (so frontend doesn’t need a copy of the catalog).

---

## 7) Resulting Repo Structure (After MVP)

```
apps/
  backend/
    prisma/
      schema.prisma
      migrations/
        2026xxxxxx_slug_suggestion_workflow/
          migration.sql
    src/
      config/
        preferences.catalog.ts
        preferences.catalog.utils.ts            # optional, recommended
      modules/
        preferences/
          preference/
            dto/
              set-preference.input.ts
              suggest-preference.input.ts
            models/
              preference.model.ts
            preference.repository.ts
            preference.resolver.ts
            preference.service.ts
      mcp/
        tools/
          preference-search.tool.ts
          preference-mutation.tool.ts
          preference-list.tool.ts              # NEW: catalog discovery
  web/
    app/
      dashboard/
        preferences/
          page.tsx
          PreferencesClient.tsx
          components/
            PreferenceItem.tsx
            SuggestionItem.tsx
docs/
  PREFERENCES_MVP_STRICT_IMPLEMENTATION.md       # this file
```

---

## 8) Testing Checklist (MVP)

### Backend unit/integration tests:
- Update any existing tests that reference category/key
- **Slug validation:**
  - unknown slug rejection with helpful error message
  - invalid slug format rejection (e.g., `"FOOD.Diet"`, `"food"`, `"food-diet"`)
- **Suggestion workflow:**
  - inferred write creates SUGGESTED and does not overwrite ACTIVE
  - inferred write for a previously REJECTED slug → no-op (does not create new SUGGESTED row)
  - acceptSuggestion promotes to ACTIVE and deletes the suggestion row
  - rejectSuggestion marks suggestion REJECTED (row preserved)
  - cannot accept/reject a preference belonging to another user
- **Scope enforcement:**
  - global slug with locationId → error
  - location slug without locationId → error
  - locationId validation (does it reference a real Location?)
- **Provenance:**
  - `confidence` required for INFERRED sourceType
  - `confidence` must be in [0, 1] range
- **Value type validation:**
  - boolean type rejects string/array/etc.
  - enum type rejects invalid option
  - array type accepts arrays, rejects non-arrays
  - empty arrays allowed (edge case)
- **Concurrent writes:**
  - Two simultaneous suggestions for same slug → both requests return success, one SUGGESTED row remains (last write wins via upsert)
  - Suggestion while user is editing ACTIVE → no conflict (different status, different rows)
- **Query scope behavior:**
  - `activePreferences(null)` returns only global
  - `activePreferences("loc-id")` returns global + location-specific

### Catalog self-validation test:
- All slugs in `PREFERENCE_CATALOG` match the regex `^[a-z]+(\.[a-z0-9_]+)+$`
- All enum definitions have non-empty `options` array
- All definitions have non-empty `description`
- No duplicate slugs (TypeScript enforces this, but good to verify)

### Web/E2E tests:
- Verify dashboard loads both ACTIVE and SUGGESTED lists
- Verify accept button promotes suggestion to active list
- Verify reject button removes suggestion from list

### MCP tool tests:
- `preference-search`: returns ACTIVE by default
- `preference-search` with `includeSuggestions`: returns both
- `preference-mutation`: rejects unknown slug with "did you mean?" hint
- `preference-mutation`: always writes as SUGGESTED (never ACTIVE)
- `preference-list`: returns all catalog entries with metadata

---

## 9) Acceptance Criteria (Must-haves)

- ✅ DB stores preferences only by `slug` (category/key removed)
- ✅ Only slugs defined in `PREFERENCE_CATALOG` can be written
- ✅ `INFERRED` writes create `SUGGESTED` rows and never overwrite `ACTIVE`
- ✅ MCP tools can ONLY create suggestions (never write ACTIVE directly)
- ✅ Context fetching returns `ACTIVE` only by default
- ✅ Suggested inbox supports accept (deletes suggestion) and reject (preserves as REJECTED)
- ✅ Scope rules enforced (global vs location)
- ✅ Query with locationId returns global + location-specific (merged)
- ✅ Provenance stored on every row (`sourceType`, optional `confidence`, optional `evidence`)
- ✅ MCP catalog discovery tool lists all valid slugs
- ✅ Unknown slug errors include "did you mean?" suggestions

---

## 10) Future Improvements (Post-MVP roadmap)

Phase 2 — Strong validation:
- Add Zod schemas per slug in the catalog for complex JSON shapes.

Phase 3 — DB-backed registry:
- Add `PreferenceDefinition` table + admin UI when non-devs need to add/edit keys.

Phase 4 — Semantic retrieval:
- Add pgvector and embed catalog descriptions when catalog grows (e.g., >50 keys).

Phase 5 — Audit/history:
- Add `PreferenceEvent` log for explainability/rollback.

Phase 6 — Privacy controls:
- Add `isSensitive` handling; redact from LLM context by default.

Phase 7 — Suggestion lifecycle:
- Auto-prune stale suggestions (e.g., >30 days).
- Prevent repeated suggestions after REJECTED (cooldown or permanent reject).
