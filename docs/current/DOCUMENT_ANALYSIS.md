# Document Analysis

- Status: current
- Read when: changing document upload, AI extraction, duplicate suggestion
  handling, suggestion review/apply, or document provenance
- Source of truth:
  `apps/backend/src/modules/preferences/document-analysis/**`,
  `apps/backend/test/e2e/document-analysis.e2e-spec.ts`, and the dashboard
  preference suggestion components
- Last reviewed: 2026-10-04

Document analysis proposes preference changes from an uploaded document. It is
separate from form fill: this path sends the uploaded document to the configured
file-capable model and returns reviewable suggestions; it does not fill a PDF.

## Upload and model boundary

Authenticated users call `POST /api/preferences/analysis` with one multipart
`file`. The default limit is 10 MiB. Accepted MIME types are plain text,
Markdown, JSON, PDF, PNG, JPEG, and common YAML variants.

The backend processes the upload in memory and does not write an application
copy to disk, the database, or object storage. Raw file bytes are sent to the
configured `AiStructuredOutputPort` file-capable provider, Vertex AI in hosted mode,
along with the filename, the user's visible schema snapshot, and current global
active preference values. JSON and YAML uploads are sent to that provider as
`text/plain` because its inline-file interface rejects their original MIME
types. In-memory application handling does not mean the document stays local or
that the model provider has no retention policy.

This describes the hosted composition. Both the SQLite local preview and explicit PostgreSQL reference preview
bind the AI ports to a fixed unavailable adapter that performs no model I/O,
and neither preview has a listener. They provide composition evidence, not a usable local
document-analysis surface; Step 06 owns the local model implementation.

The first model response is Zod-validated and capped at
`DOC_UPLOAD_MAX_SUGGESTIONS`, which defaults to 25.

## Extraction result contract

The response includes an `analysisId`, accepted `suggestions`, separately
visible `filteredSuggestions`, a document summary when available, a filtered
count, and one of these statuses:

- `success`
- `no_matches`
- `parse_error`
- `ai_error`

Each accepted suggestion identifies a valid schema slug, create/update
operation, old and new value, confidence, source snippet, optional page/line
metadata, and a stable id. The service corrects operation and old value against
current database state and filters no-change results before returning them.

## Duplicate candidate consolidation

Hard-invalid candidates, including unknown slugs, are filtered before duplicate
handling. Remaining candidates are grouped by exact slug. A group with more
than one candidate receives one additional structured model call using the
current value, the candidates, and a slug-locked output schema.

After that call, the service normalizes the proposed value, corrects
create/update and old-value fields against current state, and drops a merged
result that is now a no-op. A successful merge returns one consolidated
suggestion and retains every original candidate as a filtered `DUPLICATE_KEY`
item so the UI can show how it was combined. If the merge equals the current
value, a synthetic consolidated-no-change item is also returned in the filtered
set.

If the consolidation call or its validation fails, the service keeps the first
valid normalized candidate and marks the remaining candidates as filtered
duplicates. This fallback is deterministic but can lose useful complementary
facts from later candidates.

Public ids retain their extraction position and role after the analysis id is
prefixed. Their stable forms are:

- `<analysisId>:candidate:<index>`
- `<analysisId>:consolidated:<slug>`
- `<analysisId>:filtered:duplicate:<slug>:<index>`
- `<analysisId>:filtered:consolidated-no-change:<slug>`

Consolidation keeps one representative source snippet and optional page/line
record, not an evidence array. The additional model call per duplicate group is
an intentional accuracy/cost tradeoff.

## Applying suggestions

Analysis is proposal-only. The authenticated GraphQL mutation
`applyPreferenceSuggestions(analysisId, input)` applies client-supplied items
sequentially through the normal preference service. It does not retrieve a
stored analysis record or resolve `suggestionId` server-side.

Each successful item becomes an active `INFERRED` preference with document-
analysis origin, supplied confidence/evidence, and the `analysisId` as its
audit correlation id. Full value-type and scope enforcement happens during this
write. The resolver catches a failed item and continues, so a batch is partial-
success and not one atomic transaction.

## Known limitations

- In hosted mode, the raw upload and current context leave the machine for the configured provider.
- There is no persisted analysis object tying an apply request to the original
  server response.
- Duplicate consolidation preserves representative evidence rather than all
  evidence records and requires an extra model call per duplicate slug.
- Apply is sequential and non-atomic; callers receive only successful
  preference rows.
- Complete value-type validation is deferred until apply, not guaranteed in the
  extraction response.
- Per-user upload rate limiting remains unimplemented.

## Local Dashboard And Reviewed Apply V2

The explicit [local dashboard](../useful/LOCAL_UI.md) supplies a browser-authenticated
upload surface using the selected local adapter. No-model mode leaves manual
flows available and disables AI operations. Actual selected capabilities and
configured maximum determine accepted MIME types/bytes: supported UTF-8 text,
Markdown, JSON, YAML and text-bearing PDF, at most 10 MiB. Local images/OCR are
unsupported. Byte/structure checks and browser revalidation happen before use-case
entry. Consent, secret-file confirmation, bounded raw-file ownership and batch
cancellation apply in the local UI.

The same immutable cancellation signal and monotonic deadline reach extraction,
model work and final publication. A late result cannot publish after cancellation,
logout, session expiry or deadline. Safe optional `failureCategory` distinguishes
AI failure kinds without provider exception text. No hosted fallback occurs.

Analysis now includes an optional v2 review descriptor from a serializable saved-
state snapshot. The local UI sends `applyPreferenceSuggestionsV2`; hosted/legacy
consumers retain `applyPreferenceSuggestions`. Each v2 item compares the exact
owned definition, location, active row/absence and canonical persisted revision
inside one serializable validation/write/audit unit. Ordered outcomes are
`APPLIED`, `VALIDATION_FAILED`, `CONFLICT` or `UNCERTAIN`. Reverting every persisted
field to identical bytes is not an all-ABA guarantee. Proposed client values still
undergo domain validation; this is not a signed or persisted analysis receipt.
Items commit independently, and uncertain writes are not automatically retried.
