# Document Preference Import – Review & File Tree Suggestions

## 1. High-Level Review of Your New Plan

Your updated plan is in a great place. Key strengths:

- **Hybrid REST + GraphQL**:
  - REST for file upload and document analysis avoids `graphql-upload` complexity.
  - GraphQL for applying suggestions reuses your existing `Preference` graph and fits your current API nicely.
- **10 MB file size limit**:
  - Clear, pragmatic bound that keeps Cloud Run request times and Vertex AI context sizes reasonable.
  - Easy to enforce via an env var like `DOC_UPLOAD_MAX_BYTES=10485760`.
- **Separation of concerns**:
  - `document-text-extraction.service` to handle file type + size validation and extraction.
  - `preference-extraction.service` to construct prompts and call Vertex via `AiTextGeneratorPort`.
  - `document-analysis.controller` for REST upload endpoint.
  - `document-analysis.resolver` for GraphQL mutations to apply suggestions.

This keeps v1 simple, safe, and production‑ready, while leaving a natural path to:

- Persisting analyses in a `DocumentAnalysis` table for replay/debugging.
- Adding an “auto‑apply on upload” mode later.
- Extending to async jobs when needed.

### Small refinements (optional, not blockers)

1. **Log an `analysisId` even if you don’t persist it yet**
   - Generate an `analysisId` (e.g., UUID) for each run.
   - Include it in:
     - The REST response body.
     - Your structured logs (application logs in Cloud Run).
   - This gives you a handle in logs to debug odd behaviors without adding DB tables yet.

2. **Optional conflict checks when applying suggestions**
   - When a suggestion includes an `oldValue`, you can:
     - Fetch the current DB value for that preference.
     - If it doesn’t match `oldValue`, either:
       - Skip applying and log a “conflict”, or
       - Apply anyway but log the mismatch.
   - Not mandatory for v1, but this pattern gives you safer updates if user edits preferences in parallel.

3. **Keep the apply path model‑agnostic**
   - Route all LLM calls through `AiTextGeneratorPort` rather than directly using `vertex-ai.service`.
   - That preserves your “model gateway” abstraction and gives you a simpler path to swap Gemini ↔ Claude later.

Overall: your plan is already very solid; these refinements just improve debuggability and future evolution.

---

## 2. Suggested New File Tree After Changes

Below is how I’d expect / recommend your backend tree to evolve, focusing only on the new/changed parts.

### 2.1 Infrastructure – Document Extraction

Under `apps/backend/src/infrastructure`:

```text
apps/backend/src/infrastructure/
  auth0/
  cache/
  http/
  prisma/
  vertex-ai/
  documents/
    document-text-extraction.module.ts
    document-text-extraction.service.ts
```

**Responsibilities**

- `document-text-extraction.service.ts`:
  - Validate:
    - MIME type (e.g., `application/pdf`, `image/*`, `text/plain`, DOCX).
    - Size ≤ `DOC_UPLOAD_MAX_BYTES` (10 MB).
  - Extract normalized `string` text from:
    - PDFs (PDF library or Gemini/Vision).
    - Images (Vision/Gemini OCR).
    - Plain text and DOCX files (parsers).
  - Throw clear exceptions on unsupported types or oversize files.

- `document-text-extraction.module.ts`:
  - Provide `DocumentTextExtractionService`.
  - Export it so feature modules (e.g., `DocumentAnalysisModule`) can inject it.

### 2.2 Preferences Module – New Document Analysis Submodule

Under `apps/backend/src/modules/preferences` (building on your existing structure):

```text
apps/backend/src/modules/preferences/
  preferences.module.ts                 # existing aggregate module
  preference/                           # existing preference CRUD
    dto/
    models/
    preference.module.ts
    preference.repository.ts
    preference.resolver.ts
    preference.service.ts
  location/                             # existing
  document-analysis/                    # NEW
    document-analysis.module.ts
    document-analysis.controller.ts     # REST: POST /api/preferences/analysis (or similar)
    document-analysis.resolver.ts       # GraphQL: applyPreferenceSuggestions
    document-analysis.service.ts        # orchestrates upload → extract → AI
    preference-extraction.service.ts    # builds prompt, calls AiTextGeneratorPort
    dto/
      document-analysis-result.dto.ts
      preference-suggestion.dto.ts
      apply-preference-suggestion.input.ts
```

**Roles**

- `document-analysis.module.ts`:
  - Imports:
    - `DocumentTextExtractionModule`
    - `PreferencesModule` (or `PreferenceModule`) for querying existing preferences.
    - Module that provides `AiTextGeneratorPort` (e.g., `VertexAiModule`).
  - Declares:
    - `DocumentAnalysisController`
    - `DocumentAnalysisResolver`
    - `DocumentAnalysisService`
    - `PreferenceExtractionService`

- `document-analysis.controller.ts` (REST):
  - Endpoint like `POST /api/preferences/analysis` (adjust path as you prefer).
  - Uses Nest’s `FileInterceptor` to accept file uploads.
  - Validates file size and type (via `DocumentTextExtractionService`).
  - Orchestrates:
    - Extract text from file.
    - Call `DocumentAnalysisService.analyzeDocument(...)`.
  - Returns:
    - `analysisId`
    - `PreferenceSuggestion[]`
    - `documentSummary`

- `document-analysis.resolver.ts` (GraphQL):
  - Defines mutations like:
    - `applyPreferenceSuggestions(analysisId: ID!, input: [ApplyPreferenceSuggestionInput!]!): [Preference!]!`
  - Calls into `DocumentAnalysisService.applySuggestions(...)`.

- `document-analysis.service.ts`:
  - Orchestrates:
    - Fetch current preferences for the user.
    - Delegate to `PreferenceExtractionService` for AI analysis.
    - Coordinate applying suggestions via `PreferenceService` when requested.

- `preference-extraction.service.ts`:
  - Constructs the prompt for Vertex AI using:
    - Current preference schema.
    - Current preference values for the user.
    - Document text.
  - Calls `AiTextGeneratorPort` with a strict JSON schema.
  - Parses JSON into `PreferenceSuggestion[]`.
  - Generates an `analysisId` and returns a `DocumentAnalysisResult`.

- `dto/` directory:
  - `document-analysis-result.dto.ts`:
    - DTO shape for `analysisId`, `suggestions`, `documentSummary`.
  - `preference-suggestion.dto.ts`:
    - DTO for `PreferenceSuggestion` (key, category, operation, old/newValue, confidence, sourceSnippet, etc.).
  - `apply-preference-suggestion.input.ts`:
    - GraphQL input type matching what the frontend sends when applying.

### 2.3 Wiring / Config

These aren’t new files, but you will touch them:

- `apps/backend/src/app.module.ts`
  - Add `DocumentAnalysisModule` to the imports array.
- `apps/backend/src/config/app.config.ts` (or wherever you keep env config)
  - Add `DOC_UPLOAD_MAX_BYTES` (defaulting to 10 MB).
- Authentication / guards:
  - Ensure `DocumentAnalysisController` uses the same auth guards as your GraphQL API, typically `JwtAuthGuard` (or the equivalent you already have in `src/common/guards`).

### 2.4 Optional Tests (Recommended Layout)

If you follow your current testing structure, you could add:

```text
apps/backend/test/
  e2e/
    document-analysis.e2e.spec.ts          # end-to-end: upload → suggestions
  unit/
    document-text-extraction.service.spec.ts
    preference-extraction.service.spec.ts
```

These aren’t required for v1, but they’re good places to put tests when you’re ready.

---

## 3. Summary

- Your plan is already solid and aligned with your architecture.
- The main structural additions are:
  - A `documents/` infrastructure folder for text extraction.
  - A `document-analysis/` submodule under `preferences` with controller, resolver, services, and DTOs.
- With this structure:
  - v1 covers upload → analyze → review → apply.
  - v2+ can layer on:
    - Persistent `DocumentAnalysis` records.
    - Auto-apply flows.
    - Undo and richer audit logging.

This should be a clean, maintainable evolution of your current monolith that keeps future options open.
