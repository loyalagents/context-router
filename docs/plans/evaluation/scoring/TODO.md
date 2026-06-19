# Evaluation Scoring TODO

- Status: active follow-up list
- Last updated: 2026-06-19
- Current state: [`SUMMARY.md`](SUMMARY.md)

## Next

- [ ] Add overwrite-focused provenance to database score reports when
  `ingestion-run.json` or exported memory includes write context. The recurring
  known-schema E2E failure mode was good memory being damaged by later blank,
  stale, noisy, or low-authority suggestions; reports should make that visible
  without manual artifact diffing.
- [ ] Save a representative successful known-schema E2E example bundle if it is
  useful as a durable review reference. Curate the bundle deliberately and
  include score reports, `evaluation-run.json`, filled-form artifacts, and a
  short qualitative summary.
- [ ] Document any useful live direct-document or direct Vertex baseline
  comparison in a curated example folder, not as raw local run artifacts.
- [ ] Decide whether direct Vertex open-schema comparison tooling should write
  `evaluation-run.json`. The current v1 path intentionally omits it unless
  comparison workflow needs the shared stage report.
- [ ] Inspect fresh live E2E score rows to separate ingestion/storage failures
  from form-fill failures. Historical smoke runs showed stale address or
  email-like memory affecting storage and several wrong or missing form fields.
- [ ] Add richer withheld-but-known missing-value fixtures for stronger value
  leak scoring.
- [ ] Add generated examples of scorer outputs for a representative ingestion
  run if useful for future reviewers.
- [ ] Add MCP/backend identity hardening if live MCP research runs need stronger
  proof that the agent session and `EVAL_AUTH_TOKEN` resolve to the same backend
  user.
- [ ] Add fresh-user or guarded definition-cleanup workflows if baseline-only
  definition recording is not enough for repeatable open-schema comparisons.
- [ ] Replace the narrow open-schema form-fill condition fallback with explicit
  field-to-memory mapping validation. Models should identify which active memory
  source satisfies each conditional field policy, and backend validation should
  verify the cited source and fail closed when it is missing, inactive,
  conflicting, or value-incompatible.

## Later

- [ ] Add backend model introspection so `evaluation-run.json` can record the
  actual loaded backend model/config instead of relying only on manual labels.
- [ ] Add upload-level schema discovery if product document analysis should
  propose or create definitions before storing values.
- [ ] Add a richer source-authority policy beyond simple blank, stale, noise,
  guardrail, and forbidden-fact checks.
- [ ] Add smart conflict resolution if first-write/last-write plus overwrite
  guards repeatedly fails on realistic corpora.
- [ ] Add optional canonical-vs-alias stricter metrics.
- [ ] Add derivation-rule scoring only if strict scoring creates repeated false
  negatives.
- [ ] Add smart-search retrieval scoring as a separate eval, not as storage
  correctness.
- [ ] Add extra-slug categorization only after unscored extras show recurring
  patterns.
