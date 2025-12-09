# Document Upload → Preference Suggestions → Apply Flow (v2)

## Overview

Allow users to upload documents (PDFs, images, text files), extract relevant information with Vertex AI using the existing preference schema, and **propose** preference changes for the user to review and optionally apply.

This design intentionally keeps a **human-in-the-loop**: the AI *suggests* changes, but the backend only writes to the database after explicit user confirmation. Later, we can add an “auto-apply” path on top of the same pipeline.

## High-Level Flow

```text
1. User uploads document
2. Backend extracts text from the document
3. Backend fetches current preferences + preference schema
4. Backend sends (text + schema + current prefs) to Vertex AI via AiTextGeneratorPort
5. Vertex AI returns a list of PreferenceSuggestions (JSON)
6. Backend parses suggestions and returns them to the frontend
7. User reviews suggestions in the UI and selects which to apply (can edit values)
8. Frontend calls applyPreferenceSuggestions mutation with accepted suggestions
9. Backend validates and creates/updates/deletes preferences in Postgres
```

## File Size Limit

- **Max file size**: `10 MB` per upload (configurable)
  - Expose as an env var in the backend, e.g. `DOC_UPLOAD_MAX_BYTES=10485760`
  - Reject larger files with a clear error:  
    `"File too large. Maximum supported size is 10 MB."`
  - This keeps Cloud Run request times and Vertex AI context sizes manageable.

## API Design (GraphQL)

### 1. Analyze Document → Preference Suggestions

**Mutation**

```graphql
scalar Upload
scalar JSON

type PreferenceSuggestion {
  id: ID!                          # suggestionId (e.g. "{analysisId}:{index}")
  key: String!                     # e.g. "home_city"
  category: String!                # e.g. "location"
  operation: PreferenceOperation!  # CREATE | UPDATE | DELETE
  oldValue: JSON
  newValue: JSON
  confidence: Float!               # 0.0–1.0
  sourceSnippet: String!           # excerpt from the document
  sourceMeta: PreferenceSourceMeta
}

type PreferenceSourceMeta {
  page: Int
  line: Int
  filename: String
}

enum PreferenceOperation {
  CREATE
  UPDATE
  DELETE
}

type DocumentAnalysisResult {
  id: ID!                          # analysisId
  suggestions: [PreferenceSuggestion!]!
  documentSummary: String
}

type Mutation {
  analyzePreferencesFromDocument(file: Upload!): DocumentAnalysisResult!
}
```

**Notes**

- `analysisId` lets us log and debug individual runs, and optionally persist them.
- Each `PreferenceSuggestion` gets a stable `id` so the frontend can reference it cleanly.
- `operation` makes it future-proof (supports not just create/update but also delete).

### 2. Apply Selected Suggestions

**Input & Mutation**

```graphql
input ApplyPreferenceSuggestionInput {
  suggestionId: ID!                # from the analysis response
  key: String!
  category: String!
  operation: PreferenceOperation!
  newValue: JSON
}

type Mutation {
  applyPreferenceSuggestions(
    analysisId: ID!,
    input: [ApplyPreferenceSuggestionInput!]!
  ): [Preference!]!
}
```

**Behavior**

- Frontend sends:
  - `analysisId` plus the subset of suggestions the user accepted.
  - Optionally edited `newValue`s (if user tweaked them in the UI).
- Backend:
  - Optionally verifies the analysis exists (if persisted).
  - Maps suggestions to calls on `PreferenceService`:
    - `CREATE` → create preference
    - `UPDATE` → update existing preference
    - `DELETE` → delete preference (if supported)
  - Returns updated `Preference[]` for UI refresh.

## Backend Design (NestJS / Postgres / Vertex AI)

All lives under `apps/backend/src`.

### 1. New Module: `preferences/document-analysis`

Structure example:

```text
src/modules/preferences/document-analysis/
  document-analysis.module.ts
  document-analysis.resolver.ts      # GraphQL mutations
  document-analysis.service.ts       # orchestration
  dto/
    document-analysis-result.dto.ts
    preference-suggestion.dto.ts
```

Responsibilities:

- Handle `analyzePreferencesFromDocument` and `applyPreferenceSuggestions` mutations.
- Orchestrate document text extraction, Vertex AI calls, and preference service calls.

### 2. Shared Document Text Extraction Service

Create a reusable infrastructure service, e.g.:

```text
src/infrastructure/documents/
  document-text-extraction.module.ts
  document-text-extraction.service.ts
```

Responsibilities:

- Validate:
  - MIME type (`application/pdf`, `image/*`, `text/plain`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, etc.)
  - Size ≤ `DOC_UPLOAD_MAX_BYTES`
- Extract text depending on type:
  - PDF: use a PDF library or GCP Vision / Gemini Vision if needed
  - Images: Vision / Gemini Vision for OCR
  - Text files: read directly
  - DOCX: use a Word parsing library
- Return normalized `string` text to the domain service.

### 3. Preference Extraction Service

`PreferenceExtractionService` (in the `document-analysis` module):

- Inputs:
  - `userId`
  - `documentText: string`
  - `preferenceSchema` (derived from existing preferences/cats)
  - current preferences for the user
- Responsibilities:
  - Build a prompt for Vertex AI describing:
    - The preference schema (keys, categories, allowed value types)
    - The current preferences and their values (for context)
    - Strict JSON response format for `PreferenceSuggestion[]`
  - Call Vertex AI via `AiTextGeneratorPort` (not directly via `vertex-ai.service`), to keep the model gateway abstraction.
  - Parse the JSON response into `PreferenceSuggestion[]`.
  - Wrap into `DocumentAnalysisResult` (with a generated `analysisId`).

### 4. Apply Service

Inside `DocumentAnalysisService` or a dedicated `PreferenceSuggestionApplyService`:

- Fetch current preferences for the user.
- For each accepted suggestion:
  - Optionally verify the current DB state matches `oldValue` if provided:
    - If mismatched, skip or log as a conflict.
  - Call:
    - `preferenceService.create(...)` for `CREATE`
    - `preferenceService.update(...)` for `UPDATE`
    - `preferenceService.delete(...)` for `DELETE` (if implemented)
- Return updated `Preference[]`.

Optional (later):

- `preference_change_log` table:
  - `id`, `userId`, `preferenceKey`, `oldValue`, `newValue`, `source` (`document_analysis`), `analysisId`, timestamps
  - Enables “undo last N changes” and better auditability.

## Vertex AI Prompt & Output

High-level prompt shape (pseudocode):

```text
System: You are a data extraction assistant that reads documents and proposes preference changes for a specific user.

User:
- Here is the user's current preference schema (JSON):
  { ... }

- Here are the user's current preferences (JSON):
  { ... }

- Here is the document text:
  "<documentText>"

Task:
- Find any information in the document that clearly indicates a new or updated preference.
- For each item, output a suggestion object:
  {
    "key": string,
    "category": string,
    "operation": "CREATE" | "UPDATE" | "DELETE",
    "oldValue": any | null,
    "newValue": any | null,
    "confidence": number between 0 and 1,
    "sourceSnippet": string,
    "sourceMeta": {
      "page": number | null,
      "line": number | null
    }
  }

- Only output JSON in this exact shape:
  {
    "suggestions": [ ... ],
    "documentSummary": string
  }

- If no suggestions are found, return:
  {
    "suggestions": [],
    "documentSummary": "<short summary of the document>"
  }

- Return at most 25 suggestions, prioritizing higher-confidence items.
```

### Model and Transport

- Use the existing `AiTextGeneratorPort` and `vertex-ai` module to:
  - Hide model details from the domain.
  - Allow future swapping (Gemini ↔ Claude, etc.) with minimal impact.

## Frontend Flow (Next.js on Vercel)

In `apps/web`:

1. Add an “Import from Document” section under the Profile / Preferences area.
2. UI steps:
   - File input with:
     - Client-side check for file size `< 10 MB` and extensions.
   - Call `analyzePreferencesFromDocument` with the file.
   - Render a list of suggestions:
     - Show `key`, `category`, `oldValue`, `newValue`, `confidence`, and `sourceSnippet`.
     - Each suggestion has:
       - A checkbox (include/exclude).
       - Editable `newValue` field.
3. When user clicks “Apply selected”:
   - Collect suggestions with `checked === true`.
   - Send `analysisId` + list of `ApplyPreferenceSuggestionInput` to the backend.
   - On success, update the local preference state and show a “Changes applied” summary.

## Operational / Safety Considerations

- **File size**:
  - Enforced on both FE (soft) and BE (hard) at 10 MB.
- **Rate limiting**:
  - Per-user rate limit on `analyzePreferencesFromDocument` to avoid abuse and runaway Vertex costs.
- **Timeouts**:
  - Ensure Vertex AI and document processing finish well within Cloud Run timeout.
  - If needed, evolve to an async job:
    - `startDocumentAnalysis` → returns `analysisId`
    - `getDocumentAnalysis(analysisId)` → polling.
- **Logging & Monitoring**:
  - Log:
    - `analysisId`, userId, file type/size, number of suggestions, and how many were applied.
  - Use this for prompt tuning and debugging.
- **Security & Privacy**:
  - Validate MIME types and reject unknown types.
  - Don’t persist full document bodies unless necessary; if stored, use secure, access-controlled storage with retention limits.

## Future Extensions

- **Auto-apply mode**:
  - New mutation, e.g. `autoApplyPreferencesFromDocument(file: Upload!)`:
    - Internally calls `analyzePreferencesFromDocument` then immediately `applyPreferenceSuggestions`.
    - Gate behind a feature flag or per-user setting.
- **Undo recent changes**:
  - Use `preference_change_log` to revert a batch of changes tied to `analysisId`.
- **Batch uploads**:
  - Support multiple files per request and aggregate suggestions.
- **Multimodal improvements**:
  - Use Gemini’s vision capabilities for scanned PDFs or receipts.
