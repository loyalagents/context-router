# Evaluation Scoring TODO

- Status: active follow-up list
- Last updated: 2026-06-02

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

## Next

- [ ] Implement known-schema `ingest-documents` to upload corpus documents,
  auto-apply only suggestions returned by each upload response, and optionally
  call the exporter.
- [ ] Add optional setup for user-owned eval preference definitions needed by
  non-core accepted slugs. This creates definitions/slugs, not stored values.
- [ ] Add strict upload response contract tests for complete `suggestions[]` and
  no unsupported pagination shape.
- [ ] Add richer withheld-but-known missing value fixtures for stronger value
  leak scoring.
- [ ] Add generated examples of scorer outputs for a real ingestion run once the
  exporter/ingestor exist.
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
