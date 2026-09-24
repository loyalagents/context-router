# Form Fill

- Status: current
- Read when: changing PDF form uploads, field extraction, field policies,
  model-assisted fill planning, validation, or filled-PDF output
- Source of truth: `apps/backend/src/modules/preferences/form-fill/**`,
  `apps/backend/test/e2e/form-fill.e2e-spec.ts`, and
  `apps/web/app/dashboard/form-fill/FormFillClient.tsx`
- Last reviewed: 2026-09-22

## Current form-fill contract

### Input and processing

Authenticated users call `POST /api/form-fill/pdf` with one multipart PDF in
the `file` field and, optionally, a JSON-encoded `fieldPolicies` field. The
default upload limit is 10 MiB and the only accepted MIME type is
`application/pdf`.

The backend processes PDF bytes in memory and does not write an application
copy to disk, the database, or object storage. It extracts AcroForm metadata,
loads the user's global active preferences, obtains and validates a proposed
fill plan, mutates a copy of the PDF, and returns the result in the response.

### Model boundary

Raw PDF bytes are parsed and filled locally and are not sent to the model.
However, extracted field names/types/options/lengths, global active preference
values and descriptions, resolved form facts, and any supplied field policies
are included in the structured-model prompt. The current provider is Vertex AI.
The flow is therefore not fully local or private even though it does not send
the PDF bytes themselves.

This describes the hosted composition. Both the SQLite local preview and explicit PostgreSQL reference preview
bind the AI ports to a fixed unavailable adapter that performs no model I/O,
and neither preview has a listener. They provide composition evidence, not a usable local
form-fill surface; Step 06 owns the local model implementation.

### Supported fields and policies

Supported AcroForm field types are text, checkbox, radio, dropdown, and
single-selection option list. Buttons, signatures, and unknown fields are
reported as skipped.

An XFA entry does not by itself make the document unsupported. A hybrid PDF
with XFA plus usable AcroForm fields follows the normal fill path. A flat or
XFA-only PDF with zero AcroForm fields returns `no_fillable_fields` and no PDF
artifact. `unsupported_format` remains in the TypeScript status union but the
current service has no branch that emits it.

Optional field policies use `schemaVersion: 1`. Each named field is either a
fact mapping or an explicit structural skip. Fact mappings name a fact key and
source slugs used by fact resolution and prompt construction; they can include a
condition and a mutually exclusive checkbox group. Validation blocks structural
skips, inactive conditions, and conflicting canonical facts. The resolver also
derives supported facts such as a middle initial from active source values, and
the validator can check an active conditional checkbox from a resolved fact.

If multiple checked actions survive in one mutually exclusive group, the
validator keeps the highest-confidence action and skips the others, using PDF
field order as the tie-breaker. Policy source slugs are not currently an
enforced allowlist for general model actions, and the absence of a resolved
policy fact alone does not block a text or select action that cites active
preference slugs.

### Validation and output

The structured-response schema accepts only the supported action names; an
unknown action name fails the model-output stage rather than reaching per-field
validation. For a schema-valid response, server validation decides what is
applied. It:

- ignores actions for unknown PDF field names, safely handles omitted and
  duplicate fields, and lets only the first action for a field proceed;
- enforces action/field compatibility, option membership, text-length limits,
  source-slug existence, field policy, and checkbox-group consistency;
- requires confidence and a nonempty source-slug list for every non-skip model
  action, and requires every cited slug to be an active preference; and
- applies otherwise-valid source-backed values even below the configured
  confidence threshold, while adding a `low_confidence_applied` diagnostic
  event. The threshold is diagnostic, not a rejection rule.

Applied actions can overwrite an existing field value. Skipped fields are not
mutated, so their existing values remain. The output updates field appearances,
stays editable, and is not flattened.

`success` means at least one field was filled and none were skipped. Otherwise a
completed fill is `partial`. A caught extraction, preference-load, model,
validation, or PDF-fill failure returns `failed` with no artifact and sanitized
stage diagnostics. Successful or partial output includes a base64 PDF, output
filename/MIME type, counts, per-field source slugs and confidence, skipped
reasons, warnings, and validation events.

The dashboard form-fill page supports upload, execution, download, and summary
review.

## Known limitations

- Preference and field metadata, including values, are sent to the configured
  model provider.
- Only global active preferences are loaded; there is no location selector.
- Form uploads and results are not persisted by the application.
- The endpoint returns a base64 artifact inside JSON rather than streaming a
  file.
- Partially completed forms have no separate conflict-review workflow; valid
  applied actions overwrite their fields.
- Policy source-slug lists guide fact resolution and prompting but do not
  currently restrict a general model action to those listed slugs; a missing
  resolved fact is not by itself a rejection.
- Signatures, buttons, and multi-selection option-list behavior are not
  supported.
