# Document Upload for Preference Extraction

## Overview

Allow users to upload documents (PDFs, images, text files) and use Vertex AI to extract potential preferences, presenting suggestions for user review before updating.

This design keeps a **human-in-the-loop**: the AI *suggests* changes, but the backend only writes to the database after explicit user confirmation.

## Flow

```
┌──────────┐         ┌──────────────┐         ┌───────────┐
│  User    │         │   Backend    │         │ Vertex AI │
└────┬─────┘         └──────┬───────┘         └─────┬─────┘
     │                      │                       │
     │  1. Upload document  │                       │
     │  POST /api/prefs/    │                       │
     │  analysis (REST)     │                       │
     │─────────────────────>│                       │
     │                      │                       │
     │                      │  2. Extract text +    │
     │                      │     fetch user prefs  │
     │                      │     + build prompt    │
     │                      │──────────────────────>│
     │                      │                       │
     │                      │  3. Return suggested  │
     │                      │     preferences JSON  │
     │                      │<──────────────────────│
     │                      │                       │
     │  4. Return suggestions                       │
     │     (analysisId +    │                       │
     │     PreferenceSuggestion[])                  │
     │<─────────────────────│                       │
     │                      │                       │
     │  [User reviews list] │                       │
     │  [Checks/unchecks]   │                       │
     │  [Edits values]      │                       │
     │                      │                       │
     │  5. Apply selected   │                       │
     │  mutation apply-     │                       │
     │  PreferenceSuggestions                       │
     │  (GraphQL)           │                       │
     │─────────────────────>│                       │
     │                      │                       │
     │                      │  6. Validate & upsert │
     │                      │     to Postgres       │
     │                      │                       │
     │  7. Return updated   │                       │
     │     Preference[]     │                       │
     │<─────────────────────│                       │
```

## Architecture Decisions

### Hybrid REST + GraphQL

**Upload via REST, Apply via GraphQL.**

| Concern | Approach | Rationale |
|---------|----------|-----------|
| File upload | REST (`POST /api/preferences/analysis`) | Avoids `graphql-upload` complexity; standard NestJS `FileInterceptor` |
| Apply suggestions | GraphQL (`applyPreferenceSuggestions`) | Fits existing data graph; reuses preference service |
| Auth | Both use `JwtAuthGuard` | Consistent auth across REST and GraphQL |

### Native Multimodal Processing (No Text Extraction)

**Pass raw file buffer directly to Gemini instead of extracting text first.**

| Approach | Rationale |
|----------|-----------|
| Skip `DocumentTextExtractionService` | Gemini 1.5 Flash is multimodal - it reads PDFs/images natively |
| Pass `Buffer` + `mimeType` to Vertex AI | Preserves layout context (tables, checkboxes, headers) that text extraction loses |
| Validate file type/size in controller | Simple validation before AI call |

**Benefits:**
- Simpler architecture (fewer services, no PDF/DOCX parsing libraries)
- Better extraction quality (layout and visual context preserved)
- Works with scanned documents and images out of the box

**Trade-off:** Requires multimodal-capable model. If swapping to a text-only model later, add text extraction at that point.

## API Design

### 1. Analyze Document (REST)

**Endpoint:** `POST /api/preferences/analysis`

**Request:** `multipart/form-data` with `file` field

**Supported MIME Types:**
- `text/plain`
- `application/json`
- `application/pdf`
- `image/png`
- `image/jpeg`

**Response:**
```typescript
type AnalysisStatus = 'success' | 'no_matches' | 'parse_error' | 'ai_error';

interface DocumentAnalysisResult {
  analysisId: string;                    // For tracking/debugging
  suggestions: PreferenceSuggestion[];   // Empty array if none found
  documentSummary: string | null;
  status: AnalysisStatus;
  statusReason: string | null;           // Human-readable explanation
  filteredCount: number;                 // Number of suggestions filtered during validation
}

interface PreferenceSuggestion {
  id: string;                            // "{analysisId}:{index}"
  category: string;
  key: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  oldValue: any | null;                  // Current value if exists (corrected from DB)
  newValue: any;                         // Suggested value
  confidence: number;                    // 0.0 - 1.0
  sourceSnippet: string;                 // Excerpt from document
  sourceMeta?: {
    page?: number;
    line?: number;
    filename?: string;
  };
  wasCorrected: boolean;                 // True if operation or oldValue was corrected
}
```

**Response Examples:**

Success with suggestions:
```json
{
  "analysisId": "abc-123",
  "suggestions": [{ "id": "abc-123:0", "category": "dietary", "wasCorrected": false, ... }],
  "documentSummary": "Medical form with dietary restrictions",
  "status": "success",
  "statusReason": null,
  "filteredCount": 1
}
```

No matches found:
```json
{
  "analysisId": "abc-123",
  "suggestions": [],
  "documentSummary": "Restaurant menu for Italian bistro",
  "status": "no_matches",
  "statusReason": "No preference-related information found in document",
  "filteredCount": 0
}
```

AI returned malformed JSON:
```json
{
  "analysisId": "abc-123",
  "suggestions": [],
  "documentSummary": null,
  "status": "parse_error",
  "statusReason": "AI response could not be parsed - please try again",
  "filteredCount": 0
}
```

AI service error:
```json
{
  "analysisId": "abc-123",
  "suggestions": [],
  "documentSummary": null,
  "status": "ai_error",
  "statusReason": "AI service unavailable - please try again later",
  "filteredCount": 0
}
```

### 2. Apply Suggestions (GraphQL)

```graphql
enum PreferenceOperation {
  CREATE
  UPDATE
  DELETE
}

input ApplyPreferenceSuggestionInput {
  suggestionId: ID!
  key: String!
  category: String!
  operation: PreferenceOperation!
  newValue: JSON                         # User may have edited this
}

type Mutation {
  applyPreferenceSuggestions(
    analysisId: ID!
    input: [ApplyPreferenceSuggestionInput!]!
  ): [Preference!]!
}
```

**Behavior:**
- Frontend sends `analysisId` + subset of accepted suggestions
- User can edit `newValue` before applying
- Backend maps to `PreferenceService.create/update/delete`
- Returns updated `Preference[]` for UI refresh

## File Structure

```
apps/backend/src/
└── modules/preferences/
    └── document-analysis/
        ├── document-analysis.module.ts
        ├── document-analysis.controller.ts       # REST endpoint
        ├── document-analysis.resolver.ts         # GraphQL apply mutation
        ├── document-analysis.service.ts          # Orchestration
        ├── preference-extraction.service.ts      # Vertex AI prompt/parsing
        └── dto/
            ├── document-analysis-result.dto.ts
            ├── preference-suggestion.dto.ts
            └── apply-preference-suggestion.input.ts
```

**Note:** No separate `infrastructure/documents/` folder needed - Gemini handles file parsing natively.

## Implementation Steps

### Phase 1: File Upload Controller

1. **REST controller for file upload**
   - Location: `src/modules/preferences/document-analysis/`
   - Use `FileInterceptor` from `@nestjs/platform-express`
   - Apply `JwtAuthGuard`
   - Validate file size (≤ 10MB) and MIME type in controller
   - 10MB limit via multer config

### Phase 2: AI Integration

2. **Update `AiTextGeneratorPort` for binary input**
   - Extend interface to accept `Buffer` + `mimeType` (not just text)
   - Update `VertexAiService` to pass file buffer directly to Gemini

3. **Preference extraction service**
   - Fetch user's current preferences
   - Build preference schema (categories/keys in use)
   - Construct prompt with file buffer + schema + current prefs
   - Call Vertex AI via `AiTextGeneratorPort` (maintains abstraction)
   - Parse JSON response into `PreferenceSuggestion[]`
   - Generate `analysisId` for tracking (log even without persistence)

4. **Document analysis orchestration**
   - Wire together: upload → validate → AI → response
   - Handle errors gracefully (malformed AI response, unsupported file type, etc.)

### Phase 3: Apply Flow

5. **Apply suggestions resolver (GraphQL)**
   - Validate `analysisId` (optional: check against stored analyses in v2)
   - Optional conflict check: if suggestion has `oldValue`, compare to current DB value
     - If mismatch: skip and log conflict, or apply anyway with warning
   - For each suggestion:
     - `CREATE` → `preferenceService.create()`
     - `UPDATE` → `preferenceService.update()`
     - `DELETE` → `preferenceService.delete()`
   - Return updated preferences

### Phase 4: Frontend

6. **Upload component**
   - File picker with drag-and-drop
   - Client-side validation (size < 10MB, allowed types)
   - POST to `/api/preferences/analysis`
   - Show loading state during AI processing

7. **Suggestions review component**
   - Display each suggestion with:
     - Category / key
     - Old value → New value (diff view)
     - Confidence indicator (color-coded)
     - Source snippet
     - Checkbox to include/exclude
     - Editable `newValue` field
   - "Apply Selected" button

8. **Integration**
   - Add to preferences dashboard
   - Refresh preference list after applying

## Vertex AI Prompt Design

Since we pass the raw file buffer directly to Gemini (multimodal), the prompt references the attached document:

```
System: You are a data extraction assistant that reads documents and proposes preference changes for a user.

User:
- Here is the user's current preference schema (categories and keys):
  {schemaJson}

- Here are the user's current preferences:
  {currentPreferencesJson}

- The document is attached above.

Task:
- Analyze the attached document for any information that indicates a new or updated preference.
- For each item, output a suggestion object.
- Only suggest changes with clear evidence in the document.
- Return at most 25 suggestions, prioritizing higher-confidence items.

Respond with JSON only:
{
  "suggestions": [
    {
      "key": "string",
      "category": "string",
      "operation": "CREATE" | "UPDATE" | "DELETE",
      "oldValue": any | null,
      "newValue": any | null,
      "confidence": 0.0-1.0,
      "sourceSnippet": "string",
      "sourceMeta": { "page": number | null, "line": number | null }
    }
  ],
  "documentSummary": "string"
}

If no suggestions, return:
{
  "suggestions": [],
  "documentSummary": "Brief summary of document"
}
```

## Considerations

### File Size & Limits
- **Max upload:** 10MB (configurable via `DOC_UPLOAD_MAX_BYTES` env var)
- **Max suggestions:** 25 per document
- Reject larger files with clear error message

### Rate Limiting
- Per-user rate limit on `/api/preferences/analysis`
- Prevents abuse and controls Vertex AI costs

### Security
- Validate MIME types server-side (not just extension)
- Don't store documents long-term (process in-memory, discard)
- Sanitize filenames in response

### Error Handling
- AI returns malformed JSON → return empty suggestions with error message
- File parsing fails → clear error to user
- Timeout → suggest retrying or using smaller document

### Response Sanitization

Since AI responses can be inconsistent, we apply server-side validation and correction before returning suggestions to the user. This ensures data integrity while being flexible enough to accept valid but imperfect AI output.

**Validation Rules:**

| Rule | Action | Example |
|------|--------|---------|
| Missing required field (`category`, `key`, or `newValue`) | **Filter out** | Suggestion with no `key` is discarded |
| Duplicate `category/key` | **Filter out** (keep first) | Two suggestions for `dietary/allergies` → keep first |
| Wrong operation type | **Correct** | AI says `CREATE` but preference exists → change to `UPDATE` |
| Wrong `oldValue` | **Correct** | AI says `oldValue: "nuts"` but DB has `["nuts", "shellfish"]` → use DB value |
| `oldValue` on CREATE | **Correct** | Remove `oldValue` since preference doesn't exist |
| `newValue` equals existing value | **Filter out** | UPDATE with no actual change is pointless |

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `wasCorrected` | `boolean` | Per-suggestion flag: `true` if operation or oldValue was corrected |
| `filteredCount` | `number` | Total suggestions removed (missing fields, duplicates, no-change updates) |

**Logging:**

All corrections and filtered suggestions are logged at `WARN` level for debugging:
```
[PreferenceExtractionService] Corrected operation for dietary/allergies: AI said CREATE, but DB says UPDATE
[PreferenceExtractionService] Filtered suggestion: duplicate key travel/seat_preference
[PreferenceExtractionService] Validation complete: 5 valid suggestions, 2 filtered
```

**Frontend Indicators:**

- "Corrected" badge (orange) shown on suggestions where `wasCorrected: true`
- Header shows filtered count: "5 Suggestions Found (2 filtered)"
- Tooltip explains what "Corrected" and "filtered" mean

**Rationale:**

This "flexible validation" approach balances data integrity with AI flexibility:
- We **trust AI** for category/key discovery (allows unknown categories)
- We **verify AI** against actual DB state (corrects operation/oldValue)
- We **filter garbage** (missing required fields, exact duplicates)
- We **inform users** when corrections were made (transparency)

**TODOs:**
- [ ] Consider adding schema validation (only allow known categories) as optional strict mode
- [ ] Add confidence threshold filtering (e.g., filter suggestions below 0.3 confidence)
- [ ] Track correction rates for AI prompt improvement

### Timeouts
- Set reasonable timeout for Vertex AI calls
- If processing exceeds Cloud Run limits, consider async pattern (v2)

## Data Storage (v1)

**v1 stores no new data.** This keeps the implementation simple and avoids storing sensitive document content.

| Data | Stored? | Notes |
|------|---------|-------|
| Uploaded document | No | Process in-memory, discard after AI analysis |
| AI suggestions | No | Returned to frontend, held in UI state only |
| Applied preferences | Yes | Uses existing `Preference` table via existing service |

**Why no new storage for v1?**
- Simpler - No new tables, migrations, or cleanup jobs
- Privacy - Documents aren't retained (could contain sensitive info)
- Cheaper - No blob storage costs
- Faster to build - Reuse existing preference infrastructure

## Future Enhancements

### v2: Suggestion History (Recommended Next)

Store AI suggestions to track what was recommended vs. what was applied:

```prisma
model DocumentAnalysis {
  id              String   @id @default(uuid())
  userId          String   @map("user_id")
  filename        String
  mimeType        String   @map("mime_type")
  documentSummary String?  @map("document_summary")
  analyzedAt      DateTime @default(now()) @map("analyzed_at")

  user        User                  @relation(fields: [userId], references: [userId], onDelete: Cascade)
  suggestions PreferenceSuggestion[]

  @@index([userId])
  @@map("document_analyses")
}

model PreferenceSuggestion {
  id                 String    @id @default(uuid())
  documentAnalysisId String    @map("document_analysis_id")
  category           String
  key                String
  operation          String                              // CREATE, UPDATE, DELETE
  oldValue           Json?     @map("old_value")
  newValue           Json?     @map("new_value")
  confidence         Float
  sourceSnippet      String?   @map("source_snippet")
  wasApplied         Boolean   @default(false) @map("was_applied")
  appliedAt          DateTime? @map("applied_at")
  createdAt          DateTime  @default(now()) @map("created_at")

  documentAnalysis DocumentAnalysis @relation(fields: [documentAnalysisId], references: [id], onDelete: Cascade)

  @@index([documentAnalysisId])
  @@map("preference_suggestions")
}
```

**Benefits:**
- Track AI accuracy (suggestions made vs. applied)
- "Documents you've analyzed" history for users
- Audit trail for preference changes
- Re-surface rejected suggestions later
- Analytics on which categories are most extracted

### v2: Preference Change Log (Optional)

For undo functionality:

```prisma
model PreferenceChangeLog {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")
  preferenceKey String   @map("preference_key")
  category      String
  oldValue      Json?    @map("old_value")
  newValue      Json?    @map("new_value")
  source        String                           // 'document_analysis', 'manual', etc.
  analysisId    String?  @map("analysis_id")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([analysisId])
  @@map("preference_change_log")
}
```

### Other Future Enhancements

- **Auto-apply mode**: New mutation that skips review step (for trusted sources)
- **Batch upload**: Process multiple documents, aggregate suggestions
- **Async processing**: Return `analysisId` immediately, poll for results
- **Multimodal**: Use Gemini Vision for scanned PDFs and receipts
- **Confidence thresholds**: Auto-select suggestions above configurable threshold
- **Conflict detection**: Warn if `oldValue` doesn't match current DB state

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| File storage | v1: in-memory only |
| Upload mechanism | REST with `FileInterceptor` (not graphql-upload) |
| AI abstraction | Use `AiTextGeneratorPort` for model flexibility |
| Text extraction | Skip it - pass raw buffer to Gemini (native multimodal support) |
| Multimodal | Yes - Gemini handles PDFs/images natively, preserves layout context |
| Schema source | Hardcoded list for v1; TODO: dynamic from GraphQL schema later |
| File types | `text/plain`, `application/json`, `application/pdf`, `image/png`, `image/jpeg` |
| Error response | Structured with `status` enum + `statusReason` string |

## Open Questions (Remaining)

1. **Async processing**: For large documents, return job ID and poll for results?
2. **DELETE operation**: Support removing preferences via document analysis, or defer to v2?

---

## Appendix: Full Repo Structure After Implementation

New files marked with `← NEW`.

```
.
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma                         # (no changes for v1)
│   │   │   └── migrations/
│   │   │
│   │   └── src/
│   │       ├── app.module.ts                         # Import new modules
│   │       ├── main.ts
│   │       │
│   │       ├── common/
│   │       │   ├── decorators/
│   │       │   │   ├── current-user.decorator.ts
│   │       │   │   ├── public.decorator.ts
│   │       │   │   └── roles.decorator.ts
│   │       │   └── guards/
│   │       │       ├── gql-auth.guard.ts
│   │       │       ├── jwt-auth.guard.ts
│   │       │       └── optional-gql-auth.guard.ts
│   │       │
│   │       ├── config/
│   │       │   ├── app.config.ts
│   │       │   ├── auth.config.ts
│   │       │   ├── document-upload.config.ts         ← NEW (DOC_UPLOAD_MAX_BYTES, etc.)
│   │       │   ├── graphql.config.ts
│   │       │   ├── mcp.config.ts
│   │       │   └── vertex-ai.config.ts
│   │       │
│   │       ├── domains/
│   │       │   └── shared/
│   │       │       └── ports/
│   │       │           └── ai-text-generator.port.ts
│   │       │
│   │       ├── infrastructure/
│   │       │   ├── auth0/
│   │       │   │   ├── auth0.module.ts
│   │       │   │   └── auth0.service.ts
│   │       │   ├── prisma/
│   │       │   │   ├── prisma.module.ts
│   │       │   │   └── prisma.service.ts
│   │       │   └── vertex-ai/
│   │       │       └── vertex-ai.service.ts          # (M) Add binary input support
│   │       │
│   │       ├── modules/
│   │       │   ├── auth/
│   │       │   │   ├── auth.module.ts
│   │       │   │   ├── auth.resolver.ts
│   │       │   │   ├── auth.service.ts
│   │       │   │   └── strategies/
│   │       │   │       └── jwt.strategy.ts
│   │       │   │
│   │       │   ├── external-identity/
│   │       │   │   ├── external-identity.module.ts
│   │       │   │   ├── external-identity.repository.ts
│   │       │   │   ├── external-identity.service.ts
│   │       │   │   └── models/
│   │       │   │       └── external-identity.model.ts
│   │       │   │
│   │       │   ├── health/
│   │       │   │   ├── health.controller.ts
│   │       │   │   └── health.module.ts
│   │       │   │
│   │       │   ├── preferences/
│   │       │   │   ├── preferences.module.ts         # Import document-analysis module
│   │       │   │   │
│   │       │   │   ├── document-analysis/            ← NEW FOLDER
│   │       │   │   │   ├── document-analysis.module.ts           ← NEW
│   │       │   │   │   ├── document-analysis.controller.ts       ← NEW (REST endpoint)
│   │       │   │   │   ├── document-analysis.resolver.ts         ← NEW (GraphQL apply mutation)
│   │       │   │   │   ├── document-analysis.service.ts          ← NEW (orchestration)
│   │       │   │   │   ├── preference-extraction.service.ts      ← NEW (Vertex AI prompt/parsing)
│   │       │   │   │   └── dto/
│   │       │   │   │       ├── document-analysis-result.dto.ts   ← NEW
│   │       │   │   │       ├── preference-suggestion.dto.ts      ← NEW
│   │       │   │   │       └── apply-suggestion.input.ts         ← NEW
│   │       │   │   │
│   │       │   │   ├── location/
│   │       │   │   │   ├── dto/
│   │       │   │   │   │   ├── create-location.input.ts
│   │       │   │   │   │   └── update-location.input.ts
│   │       │   │   │   ├── location.module.ts
│   │       │   │   │   ├── location.repository.ts
│   │       │   │   │   ├── location.resolver.ts
│   │       │   │   │   ├── location.service.ts
│   │       │   │   │   └── models/
│   │       │   │   │       └── location.model.ts
│   │       │   │   │
│   │       │   │   └── preference/
│   │       │   │       ├── dto/
│   │       │   │       │   ├── create-preference.input.ts
│   │       │   │       │   └── update-preference.input.ts
│   │       │   │       ├── models/
│   │       │   │       │   └── preference.model.ts
│   │       │   │       ├── preference.module.ts
│   │       │   │       ├── preference.repository.ts
│   │       │   │       ├── preference.resolver.ts
│   │       │   │       └── preference.service.ts
│   │       │   │
│   │       │   ├── user/
│   │       │   │   ├── dto/
│   │       │   │   │   ├── create-user.input.ts
│   │       │   │   │   └── update-user.input.ts
│   │       │   │   ├── models/
│   │       │   │   │   └── user.model.ts
│   │       │   │   ├── user.module.ts
│   │       │   │   ├── user.repository.ts
│   │       │   │   ├── user.resolver.ts
│   │       │   │   └── user.service.ts
│   │       │   │
│   │       │   └── vertex-ai/
│   │       │       ├── vertex-ai.module.ts
│   │       │       └── vertex-ai.resolver.ts
│   │       │
│   │       ├── mcp/
│   │       │   ├── mcp.controller.ts
│   │       │   ├── mcp.module.ts
│   │       │   ├── mcp.service.ts
│   │       │   ├── resources/
│   │       │   │   └── schema.resource.ts
│   │       │   ├── tools/
│   │       │   │   ├── preference-mutation.tool.ts
│   │       │   │   └── preference-search.tool.ts
│   │       │   └── types/
│   │       │       └── mcp-context.type.ts
│   │       │
│   │       └── schema.gql                            # Auto-generated (will include new types)
│   │
│   └── web/
│       ├── app/
│       │   ├── api/
│       │   │   └── ...
│       │   ├── dashboard/
│       │   │   ├── chat/
│       │   │   │   └── ...
│       │   │   ├── profile/
│       │   │   │   └── ...
│       │   │   └── preferences/                      ← NEW FOLDER (or add to profile)
│       │   │       ├── page.tsx                      ← NEW (preferences list + upload)
│       │   │       └── components/
│       │   │           ├── DocumentUpload.tsx        ← NEW (file picker, drag-drop)
│       │   │           ├── SuggestionsList.tsx       ← NEW (review suggestions)
│       │   │           └── SuggestionItem.tsx        ← NEW (single suggestion row)
│       │   └── ...
│       │
│       ├── lib/
│       │   ├── apollo-client.ts
│       │   ├── generated/
│       │   │   └── graphql.ts                        # Will include new types after codegen
│       │   └── ...
│       │
│       └── ...
│
├── docs/
│   ├── AUTHORIZATION_TODO.md
│   ├── FILE_UPLOAD_PLAN.md                           ← THIS FILE
│   ├── FILE_UPLOAD_SUGGESTION_1.md
│   ├── FILE_UPLOAD_SUGGESTION_2.md
│   ├── LOCKING_TODO.md
│   └── MCP_INTEGRATION.md
│
└── ...
```

### Summary of New Files

#### Backend (8 new files)

| File | Purpose |
|------|---------|
| `config/document-upload.config.ts` | Environment config for upload limits |
| `modules/preferences/document-analysis/document-analysis.module.ts` | Feature module |
| `modules/preferences/document-analysis/document-analysis.controller.ts` | REST `POST /api/preferences/analysis` |
| `modules/preferences/document-analysis/document-analysis.resolver.ts` | GraphQL `applyPreferenceSuggestions` |
| `modules/preferences/document-analysis/document-analysis.service.ts` | Orchestrates upload → AI → response |
| `modules/preferences/document-analysis/preference-extraction.service.ts` | Builds prompt, calls Vertex AI, parses response |
| `modules/preferences/document-analysis/dto/document-analysis-result.dto.ts` | Response DTO |
| `modules/preferences/document-analysis/dto/preference-suggestion.dto.ts` | Suggestion DTO |
| `modules/preferences/document-analysis/dto/apply-suggestion.input.ts` | GraphQL input for applying |

#### Frontend (4 new files)

| File | Purpose |
|------|---------|
| `app/dashboard/preferences/page.tsx` | Preferences page with upload integration |
| `app/dashboard/preferences/components/DocumentUpload.tsx` | File picker with drag-and-drop |
| `app/dashboard/preferences/components/SuggestionsList.tsx` | Review list of AI suggestions |
| `app/dashboard/preferences/components/SuggestionItem.tsx` | Single suggestion with checkbox, diff, edit |

#### Modified Files

| File | Change |
|------|--------|
| `apps/backend/src/app.module.ts` | Import `DocumentAnalysisModule` |
| `apps/backend/src/modules/preferences/preferences.module.ts` | Import `DocumentAnalysisModule` |
| `apps/backend/src/domains/shared/ports/ai-text-generator.port.ts` | Add binary input support (`Buffer` + `mimeType`) |
| `apps/backend/src/infrastructure/vertex-ai/vertex-ai.service.ts` | Implement binary input for Gemini |
| `apps/backend/.env.example` | Add `DOC_UPLOAD_MAX_BYTES` |

#### Recommended Tests (Optional)

| File | Purpose |
|------|--------|
| `test/e2e/document-analysis.e2e.spec.ts` | End-to-end: upload → suggestions |
| `test/unit/preference-extraction.service.spec.ts` | Unit test for prompt/parsing logic |
