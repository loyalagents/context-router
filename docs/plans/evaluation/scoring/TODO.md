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

## Next

- [ ] Implement `ingest-documents` to upload corpus documents, auto-apply
  extracted suggestions into active preferences, and optionally call the exporter.
- [ ] Add setup for user-owned eval preference definitions needed by non-core
  accepted slugs.
- [ ] Add richer withheld-but-known missing value fixtures for stronger value
  leak scoring.
- [ ] Add generated examples of scorer outputs for a real ingestion run once the
  exporter/ingestor exist.

## Later

- [ ] Add Codex/Claude MCP runner that produces the same artifacts as the
  ingestor/exporter path.
- [ ] Add optional canonical-vs-alias stricter metrics.
- [ ] Add derivation-rule scoring only if strict scoring creates repeated false
  negatives.
- [ ] Add smart-search retrieval scoring as a separate eval, not as storage
  correctness.
- [ ] Add extra-slug categorization only after unscored extras show recurring
  patterns.
