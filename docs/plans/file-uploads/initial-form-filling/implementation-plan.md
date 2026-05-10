# Initial Fillable PDF Form Filling Plan

## Summary
Implement a no-storage v1 where an authenticated dashboard user uploads a **fillable PDF**, the backend extracts AcroForm fields with `pdf-lib`, uses text-only AI plus active stored preferences to decide fill actions, writes validated values into the PDF, and returns a downloadable filled PDF with a structured summary.

V1 does not send PDF bytes to AI. It does not persist raw uploads, drafts, templates, or filled PDFs.

## Public Interface
- Add backend dependency: `pdf-lib`.
- Add `POST /api/form-fill/pdf`.
  - Auth: `JwtAuthGuard`.
  - Request: multipart `file`, `application/pdf` only.
  - Response:
    ```ts
    {
      fillId: string;
      status:
        | "success"
        | "partial"
        | "no_fillable_fields"
        | "unsupported_format"
        | "failed";
      originalFilename: string;
      outputFilename: string;
      outputMimeType: "application/pdf";
      filledPdfBase64: string | null;
      summary: {
        totalFields: number;
        filledCount: number;
        skippedCount: number;
        filledFields: Array<{
          pdfFieldName: string;
          fieldType: string;
          sourceSlugs: string[];
          confidence: number;
        }>;
        skippedFields: Array<{
          pdfFieldName: string;
          fieldType: string;
          reason: string;
          confidence?: number;
          sourceSlugs?: string[];
        }>;
        warnings: string[];
      };
    }
    ```
- `filledPdfBase64` is non-null only for `success` and `partial`; it is null for `no_fillable_fields`, `unsupported_format`, and `failed`.
- Status rules:
  - `success`: fields were filled and no fields were skipped.
  - `partial`: at least one field was skipped or an AI action was rejected, whether or not other fields were filled.
  - `no_fillable_fields`: PDF has no AcroForm fields and no XFA marker.
  - `unsupported_format`: XFA form detected.
  - `failed`: unreadable PDF, AI failure, or unrecoverable server error.

## Backend Implementation
- Add `FormFillModule` under `apps/backend/src/modules/preferences/form-fill/`.
- Add config:
  - `FORM_FILL_MAX_BYTES`, default `10MB`.
  - allowed MIME: `application/pdf`.
  - `FORM_FILL_CONFIDENCE_THRESHOLD`, default `0.75`.
- Use service boundaries:
  - `PdfFieldExtractorService`: load PDF, detect XFA, extract field name/type/options.
  - `FormFillPromptBuilderService`: build text-only prompt from field metadata, active preferences, and definitions.
  - `FormFillValidatorService`: validate AI actions against fields, active slugs, confidence, and options.
  - `PdfFieldFillerService`: apply validated actions to the original PDF buffer.
  - `FormFillService`: orchestrate extraction, AI call, validation, implicit skips, filling, and response creation.
- Use existing `AiStructuredOutputPort.generateStructured`, not `generateStructuredWithFile`.

## AI Contract
- Use a Zod schema equivalent to:
  ```ts
  const FillActionSchema = z.object({
    fieldName: z.string(),
    action: z.enum(["SET_TEXT", "CHECK", "UNCHECK", "SELECT_OPTION", "SKIP"]),
    value: z.string().optional(),
    sourceSlugs: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    skipReason: z.string().optional(),
  });

  const FormFillAiResponseSchema = z.object({
    fillActions: z.array(FillActionSchema),
  });
  ```
- Prompt requirements:
  - Return one action for every extracted field.
  - Use exact case-sensitive AcroForm field names.
  - Do not invent fields or options.
  - Use exact option values from metadata for radio/dropdown/list fields.
  - Use `SKIP` with `sourceSlugs: []` when memory is missing, confidence is low, field is unsupported, or the field should not be filled.
- Validation behavior:
  - Unknown field, incompatible action, invalid option, unknown active slug, missing required value, low confidence, and omitted AI fields become skipped/rejected field summaries.
  - `SET_TEXT` and `SELECT_OPTION` require a non-empty string `value`.
  - `CHECK`, `UNCHECK`, and `SKIP` ignore `value`.
  - After validation, add implicit skipped-field entries for any extracted fields omitted by the AI so `filledCount + skippedCount === totalFields`.
  - Valid actions continue to be filled even if other actions are invalid.
  - Signatures, certification/declaration fields, submit buttons, and unsupported fields are never filled.

## PDF Filling Behavior
- Text fields: `SET_TEXT`.
- Checkboxes: `CHECK` / `UNCHECK`; do not compare against raw PDF checkbox export values.
- Dropdowns and radio groups: `SELECT_OPTION` with exact option value.
- Option lists: `SELECT_OPTION` with a one-element selected option list in v1.
- Leave fields editable; do not flatten PDFs.
- Embed `StandardFonts.Helvetica` and call `form.updateFieldAppearances(font)` before saving so values display in common PDF viewers.
- Return base64 PDF JSON for v1; frontend should create and revoke Blob object URLs without retaining unnecessary base64 state.

## Dashboard
- Add `/dashboard/form-fill`.
- Add a `Form Fill` link from `/dashboard`.
- Page behavior:
  - authenticated server page obtains access token
  - client upload component accepts one PDF
  - calls `POST /api/form-fill/pdf`
  - creates a downloadable PDF Blob from non-null `filledPdfBase64`
  - handles null `filledPdfBase64` for unsupported/no-field/failed statuses
  - displays status, counts, warnings, filled fields, and skipped fields
  - shows clear copy that skipped fields were left blank rather than guessed.

## Tests
- Unit tests:
  - field extraction for text, checkbox, radio, dropdown, option-list fields
  - XFA detection returns `unsupported_format`
  - prompt includes exact field names, option values, active preferences, and one-action-per-field instruction
  - validator rejects/skips unknown fields, incompatible actions, invalid options, unknown slugs, missing values, omitted fields, and low confidence
  - filler writes text, checkbox, radio, dropdown, and option-list values into generated PDFs
  - filler embeds a standard font and returns non-empty PDF bytes.
- E2E test:
  - seed active preferences
  - generate fillable PDF with `pdf-lib`
  - mock `generateStructured`
  - upload to `/api/form-fill/pdf`
  - assert response status/summary/base64 nullability
  - assert `filledCount + skippedCount === totalFields`
  - decode returned PDF and verify field values.
- Run:
  - targeted new backend tests
  - `pnpm --filter backend build`
  - `pnpm --filter web build`

## Required Documentation
- Create `docs/plans/file-uploads/initial-form-filling/implementation-summary.md` after implementation covering:
  - endpoint and dashboard page
  - no-storage behavior
  - text-only AI mapping approach
  - supported field types
  - skipped-field/XFA behavior
  - tests run.
- Create `docs/plans/file-uploads/TODO.md` with future work:
  - multimodal fallback for fillable PDFs with opaque field names
  - fallback triggers: low useful-field-name score, low fill ratio, or user “try harder”
  - long-term raw file storage/GCS
  - temporary local storage for async retries
  - draft/review flow
  - ask-user-later flow for missing values
  - saved reusable templates
  - flat/scanned PDF OCR and coordinate overlays
  - image upload support
  - HTML upload with direct filled HTML output
  - optional HTML-to-PDF rendering
  - PDF flattening
  - stronger sensitive-field policy
  - more memory slugs such as address, phone, and emergency contact
  - batch filling, template matching, audit history, and visual QA fixtures.

## Assumptions
- V1 uses active preferences only; suggested preferences are ignored.
- V1 does not create, update, or infer memories.
- V1 leaves unknown fields blank rather than asking the user or guessing.
- V1 supports fillable PDFs only; flat PDFs, scanned PDFs, images, and HTML are future work.
