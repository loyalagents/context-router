# Evaluation Scoring TODO

- Status: active follow-up list
- Last updated: 2026-06-17

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
- [x] Form score reports structural overfill diagnostics separately from
  primary known-field and abstention accuracy.
- [x] Direct-document baseline prompt includes policy-only skip guidance for
  structural fields without exposing fact keys or expected values.
- [x] Direct-document baseline treats model-authored confidence as diagnostic
  metadata rather than a hard fill gate.
- [x] MCP known-schema agent runner via `pnpm eval:e2e-mcp-agent`.
  - Validates documents, prepares memory/schema, runs one Claude MCP-capable
    agent session or explicit command test adapter, exports active memory,
    fills the form from backend memory, and reuses existing score reports.
  - Stages an agent workspace with declared corpus documents only. This avoids
    exposing fixture truth through the prompt/source paths, but is not an
    OS-level filesystem sandbox.
  - Uses explicit Claude MCP config and a sanitized child environment for live
    agent runs, while allowing documented Claude/headless model-provider auth
    variables.
  - Writes `mcp-agent-run.json`, prompt, transcript, and the shared
    `evaluation-run.json` stage report.
  - Reserves `--schema-mode open` and `--form-mode agent` behind usage errors.
  - Records that MCP/backend identity is not yet verified; hard identity
    preflight remains deferred.
  - Live Claude runs fail if the configured MCP server is unavailable, no
    `mcp__<server>__*` tools are exposed, or the required completion marker is
    missing.
  - First local live Claude MCP smoke completed on 2026-06-16: 27 active
    preferences exported, 21/22 known-present database facts correct, and 16/17
    known form fields correct.
- [x] MCP scoring follow-up documentation and backend form-fill prompt
  hardening.
  - Clarifies that MCP `--schema-mode known` means existing visible backend
    schema, not a closed target-form-only schema.
  - Records that backend known-schema document ingestion and MCP known-schema
    agent runs are intentionally different producers.
  - Makes backend form-fill prompts treat field policies as authoritative and
    instructs the model not to make semantically similar source substitutions.
  - Keeps off-policy source slug validation diagnostic-only so evaluation
    scoring still captures backend form-fill mistakes truthfully.
- [x] Open-schema evaluation planning consolidation.
  - Merged the duplicate open-schema brainstorm drafts into
    `docs/plans/evaluation/scoring/open-schema/brainstorm.md`.
  - Added
    `docs/plans/evaluation/scoring/open-schema/orchestration.md`
    with artifact-first checkpoints.
  - Recorded that open-schema should prioritize final form correctness, then
    active-memory value recovery, then schema diagnostics.
- [x] Open-schema Checkpoint 1 memory snapshot export.
  - Added `pnpm eval:export-memory-snapshot`.
  - Added schema-validated `memory-snapshot.json` export with active
    preferences, optional suggestions, visible definitions, and definition
    baseline diagnostics.
  - Kept known-schema `stored-preferences.json` and known-schema reports
    unchanged.
- [x] Open-schema Checkpoint 2 static scoring.
  - Added `pnpm eval:score --mode open-schema-database`.
  - Added `pnpm eval:score --mode open-schema-combined`.
  - Added schema-validated `open-schema-database-score-report.json` and
    `open-schema-combined-score-report.json`.
  - Scores active-memory value recovery ahead of slug correctness and keeps
    schema quality deterministic/diagnostic.
  - Joins open-schema memory outcomes with the existing form score report
    without changing known-schema report contracts.
- [x] Open-schema Checkpoint 3 MCP open-mode runner wiring.
  - Enabled `pnpm eval:e2e-mcp-agent --schema-mode open --form-mode backend`
    for the deterministic command adapter.
  - Added `examples/eval/prompts/mcp-open-schema.md`.
  - Captures `definition-baseline.json` before the agent stage.
  - Exports `memory-snapshot.json` with `baseline-only`,
    `--baseline-in`, `--include-suggestions`, and producer
    `mcp-open-schema-agent`.
  - Scores with `open-schema-database` and `open-schema-combined`.
- [x] Open-schema Checkpoint 4 live Claude runner enablement.
  - Accepts `--agent claude --schema-mode open --form-mode backend` with an
    explicit Claude MCP config.
  - Reuses the PR3 open-schema artifact chain unchanged.
  - Keeps `--agent codex`, `--form-mode agent`, hard identity tooling, and
    automated schema cleanup deferred.

## Next

- [ ] Document the live direct-document baseline comparison in an example
  folder if the Pro/Flash/E2E results are useful as a durable reference.
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
- [ ] Add MCP/backend identity hardening later if research runs need stronger
  proof that the Claude MCP session and `EVAL_AUTH_TOKEN` resolve to the same
  backend user.
- [ ] Add fresh-user or guarded definition-cleanup workflows later if
  baseline-only definition recording is not enough for repeatable open-schema
  comparisons.

## Later

- [ ] Add upload-level schema discovery if product document analysis should
  propose or create definitions before storing values.
- [ ] Add optional canonical-vs-alias stricter metrics.
- [ ] Add derivation-rule scoring only if strict scoring creates repeated false
  negatives.
- [ ] Add smart-search retrieval scoring as a separate eval, not as storage
  correctness.
- [ ] Add extra-slug categorization only after unscored extras show recurring
  patterns.
