# Evaluation Scoring TODO

- Status: active follow-up list
- Last updated: 2026-06-13

## Implemented

- [x] First-pass database scorer over `stored-preferences.json`.
- [x] First-pass form-fill scorer over `filled-form.json`.
- [x] Combined fact-keyed report with stage attribution.
- [x] Stored-preferences and score-report schemas.
- [x] Accepted slug map with canonical and alias slugs.
- [x] Scorer CLI via `pnpm eval:score`.
- [x] Scorer contract hardening: active-only storage input, full form snapshot
  identity checks, clean conflict metrics, closed combined-stage buckets, and
  stricter score-report schemas.
- [x] Corpus-truth validation for concrete withheld values before DB scoring.
- [x] Stored-preferences exporter via existing authenticated GraphQL APIs.
- [x] Exporter query-contract tests against the backend GraphQL schema.
- [x] Ingestor benchmark brainstorm split known-schema document ingestion from
  open-schema definition/slug discovery.
- [x] Known-schema `ingest-documents` command.
- [x] Optional setup for user-owned eval preference definitions needed by
  target slugs. This creates definitions/slugs, not stored values.
- [x] Strict upload response contract tests for complete `suggestions[]` and no
  unsupported pagination shape.
- [x] Backend-memory `eval:fill-form` command that writes `filled-form.json`.
- [x] Optional filled-PDF, redacted form-fill response, and form score report
  outputs from the form runner.
- [x] Alex realistic live form-fill scenario with no committed golden snapshot.
- [x] Known-schema single-call wrapper via `pnpm eval:e2e-known-schema`.
- [x] `evaluation-run.json` artifact for stage order, partial failures, skipped
  stages, and output artifact paths.
- [x] Explicit validation report input for database scoring so wrapper runs
  score the exact document root they validated.
- [x] First live `pnpm eval:e2e-known-schema` smoke completed end to end for
  `alex-i9-test` / `realistic` / `alex-i9-realistic`.
  - Result was a pipeline pass with partial form fill.
  - Database score: 16/22 known-present facts correct, 4 wrong values, 2 wrong
    slugs, 1/1 intentionally missing fact absent.
  - Form score: 11/17 known fields correct, 1 missing, 5 wrong, 1/1
    intentionally missing field absent.
  - Combined score produced stage attribution across storage and form-fill.
- [x] Fixed the live form-fill blocker where dashed SSNs such as
  `000-00-0292` crashed I-9 PDF writing because the target field has
  `maxLength=9`.
- [x] Direct-document form-fill baseline via
  `pnpm eval:fill-form-from-docs`.
  - Reads local corpus documents and PDF field metadata into one Vertex prompt.
  - Writes the existing `filled-form.json` snapshot shape and optional form
    score report without calling the backend or DB.

## Next

- [ ] Run and document a live direct-document baseline smoke for
  `alex-i9-realistic`, then compare form score against the known-schema E2E
  score.
- [ ] Document the completed live known-schema E2E smoke in an example folder
  with `evaluation-run.json`, score reports, filled PDF, and qualitative notes.
- [ ] Inspect the live E2E score rows to separate ingestion/storage failures
  from form-fill failures:
  - database wrong values included stale address/email-like memory in the smoke
    run.
  - form score had 5 wrong known fields and 1 missing known field.
- [ ] Persist terminal `eval:fill-form` backend responses even when the status
  is `failed`, `no_fillable_fields`, or `unsupported_format`, so future live
  failures leave a response artifact for debugging.
- [ ] Add richer withheld-but-known missing value fixtures for stronger value
  leak scoring.
- [ ] Add generated examples of scorer outputs for a representative ingestion
  run if useful for future reviewers.
- [ ] Design open-schema ingestion with definition/slug creation.
- [ ] Decide ordering for open-schema ingestion work:
  - MCP/Codex/Claude agent runner.
  - Upload-level schema discovery with proposed definitions.

## Later

- [ ] Add MCP/Codex/Claude runner that produces the same artifacts as the
  ingestor/exporter path and tests agent-driven definition/slug discovery.
- [ ] Add upload-level schema discovery if product document analysis should
  propose or create definitions before storing values.
- [ ] Add optional canonical-vs-alias stricter metrics.
- [ ] Add derivation-rule scoring only if strict scoring creates repeated false
  negatives.
- [ ] Add smart-search retrieval scoring as a separate eval, not as storage
  correctness.
- [ ] Add extra-slug categorization only after unscored extras show recurring
  patterns.
