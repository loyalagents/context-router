# File Uploads TODO

- Status: follow-up
- Last reviewed: 2026-05-10

## Form Filling

- Add multimodal fallback for fillable PDFs with opaque AcroForm field names.
  - Candidate triggers: low useful-field-name score, low fill ratio, or a user-facing “try harder” action.
  - Reuse the same fill-action schema and validation layer.
- Add a draft/review flow before rendering the final PDF.
- Add an ask-user-later flow for required values that memory cannot fill.
- Add saved reusable form templates derived from previously uploaded forms.
- Add PDF flattening as an optional export mode.
- Add stronger sensitive-field policy for legal, tax, medical, signature, citizenship, and certification fields.
- Add more core memory slugs for practical forms, such as address, phone, emergency contact, pronouns, locale, and timezone.
- Add batch filling for repeated forms.
- Add template matching/versioning for recurring PDF forms.
- Add audit/history for form-fill attempts without storing raw file contents.

## File Storage

- Add temporary local storage only if async processing or retry support becomes necessary.
- Add long-term object storage, likely GCS, only when users need document history, original-file retention, reprocessing, or durable filled artifacts.
- Define retention, deletion, access control, and audit behavior before storing raw uploaded files.
- Consider storing only derived manifests and drafts in Postgres while continuing not to retain raw files by default.

## Broader Input Formats

- Add flat/scanned PDF support with OCR and coordinate overlays.
- Add image upload support for form screenshots or scanned forms.
- Add HTML upload support with direct filled HTML output.
- Consider optional HTML-to-PDF rendering after direct HTML output works.
- Add support for messier PDFs where fields exist but labels are only visible in static page content.

## Quality And Operations

- Add visual QA fixtures for real public fillable PDFs.
- Add frontend tests around base64-to-Blob handling and object URL cleanup.
- Add manual smoke-test scripts for demo accounts.
- Add rate limiting or abuse controls if form fill becomes publicly accessible.
- Add clearer user copy for skipped fields and unsupported formats after testing with real forms.
