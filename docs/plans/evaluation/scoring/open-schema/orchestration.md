# Open-Schema Evaluation Orchestration

- Status: active implementation plan
- Last updated: 2026-06-17
- Scope: checkpoint plan for open-schema evaluation support

## Target Flow

Open schema should be added as an extension of the existing eval stack, not as a
parallel benchmark framework.

```text
validate-documents
  -> setup-open-schema-memory
  -> capture-definition-baseline
  -> run-mcp-agent
  -> export-memory-snapshot
  -> score-open-schema-database
  -> fill-form
  -> score-form
  -> score-open-schema-combined
```

The first implementation should support static artifact scoring before enabling
live MCP `--schema-mode open`.

Direct Vertex no-storage comparison is intentionally separate from the backend
MCP flow:

```text
declared source documents + safe form context
  -> direct Vertex open-schema extraction
  -> fact-only direct Vertex form fill
  -> score-form
  -> optional synthetic memory snapshot
  -> optional score-open-schema-database
  -> optional score-open-schema-combined
```

Docs:

- `docs/plans/evaluation/scoring/open-schema/open-schema-baseline/implementation-plan.md`
- `docs/plans/evaluation/scoring/open-schema/open-schema-baseline/implementation-summary.md`

## Checkpoints

### Checkpoint 1: Memory Snapshot Export (implemented in PR1)

Docs:

- `docs/plans/evaluation/scoring/open-schema/pr1/implementation-plan.md`
- `docs/plans/evaluation/scoring/open-schema/pr1/implementation-summary.md`

Goal:

- Add `memory-snapshot.json` as a new open-schema artifact.
- Export active preferences, optional suggestions, visible definitions, and a
  pre-run definition baseline.
- Keep `stored-preferences.json` unchanged for known-schema scoring.

Implementation notes:

- Prefer a new exporter command or mode over changing the existing
  `stored-preferences.json` v1 contract.
- Query `activePreferences`, optional `suggestedPreferences`, `me`, and
  `exportPreferenceSchema(scope: ALL)`.
- Capture the pre-run definition baseline before the agent can create or
  archive definitions. This can be an internal runner call or a saved baseline
  artifact, but it must happen before `run-mcp-agent`.
- Include all visible unarchived definitions, not only definitions referenced
  by active values. Preserve `archivedAt` if the backend returns it.
- Record `locationId`, `locationMode` (`global-only` or `merged-location`),
  and whether active preferences were exported as a merged location view.
- Record `schemaResetMode` / baseline strategy even if the first live run is
  smoke-only.
- Detect run-created definitions in v1 by diffing post-run definition IDs
  against the pre-run baseline. Slug diffs are useful diagnostics, but IDs
  should be the primary machine signal when available.
- Do not rely on definition timestamps for v1. Current GraphQL
  `PreferenceDefinition` export does not expose `createdAt` or `updatedAt`; add
  backend provenance later only if baseline diffs are insufficient.

Tests:

- `memory-snapshot.schema.json` validates representative artifacts.
- GraphQL query contract validates against `apps/backend/src/schema.gql`.
- Preference rows preserve `definitionId` so later scorers can join them to
  exported definitions without changing the raw memory snapshot.
- Definitions with no active value are preserved.
- Location diagnostics distinguish global-only from merged-location exports.
- Pre-run baseline and post-run definitions identify new definition IDs.
- Malformed preference/definition rows, user mismatches, GraphQL errors, and
  HTTP errors fail clearly.
- Auth tokens and GraphQL URL credentials remain redacted from CLI errors and
  artifacts.

Stop point achieved:

- A static backend export can write a valid `memory-snapshot.json` with baseline
  and location diagnostics; no agent changes are required yet.

### Checkpoint 2: Static Open-Schema Scorers (implemented in PR2)

Docs:

- `docs/plans/evaluation/scoring/open-schema/pr2/implementation-plan.md`
- `docs/plans/evaluation/scoring/open-schema/pr2/implementation-summary.md`

Goal:

- Add deterministic scoring from `memory-snapshot.json`.
- Produce `open-schema-database-score-report.json`.
- Produce `open-schema-combined-score-report.json` from the open-schema DB
  report plus the existing form score report.

Implementation notes:

- Add `pnpm eval:score --mode open-schema-database` and
  `--mode open-schema-combined`.
- Add open-schema-specific report schemas without changing known-schema
  `database-score-report.json`, `combined-score-report.json`, or
  `stored-preferences.json`.
- Validate `memory-snapshot.json` and require matching `userId` / `corpusId`
  before scoring.
- Reuse fixture-readiness logic and deterministic normalization from the
  known-schema database scorer.
- Score known-present facts by active-memory value recovery first:
  accepted-slug recovery, novel-slug recovery, suggestion-only recovery, wrong
  active value, and missing active value.
- Preserve accepted canonical/alias slug matches and conflicts as diagnostics.
- Keep suggestions diagnostic except for the explicit suggestion-only
  known-present bucket.
- Score intentionally missing facts by active-memory hallucination first:
  absent correctly, withheld value found, accepted missing key populated, or
  both.
- Add deterministic schema diagnostics for definition counts, copied baseline
  diffs, duplicate slug groups, empty descriptions, missing `definitionId`
  references, and unscored active/suggested rows.
- Reuse the existing form scorer without changing known-schema form report
  semantics.

Tests:

- Expected value found under accepted slug.
- Expected value found under novel slug.
- Expected value found only in suggestions.
- Expected value missing.
- Accepted slug populated with wrong value.
- Conflicting values are reported.
- Intentionally missing value absent.
- Intentionally missing value or accepted key hallucinated.
- Ambiguous matching remains diagnostic.
- Combined attribution covers memory-found, memory-missing, missing-absent, and
  missing-hallucinated form outcomes.
- Known-schema score CLI modes continue to parse and pass existing tests.

Stop point achieved:

- Static memory/form artifacts produce stable open-schema DB and combined
  reports without running an agent.

### Checkpoint 3: MCP Open-Mode Runner (implemented in PR3)

Docs:

- `docs/plans/evaluation/scoring/open-schema/pr3/implementation-plan.md`
- `docs/plans/evaluation/scoring/open-schema/pr3/implementation-summary.md`

Goal:

- Enable `pnpm eval:e2e-mcp-agent --schema-mode open --form-mode backend`.
- Exercise the full open-schema stage list with the deterministic `command`
  adapter before any live Claude run.

Implementation notes:

- Remove the reserved-mode usage error only for supported backend-form open
  mode.
- Skip known-schema target-definition setup by forcing definition setup off in
  open mode.
- Reset memory values when requested.
- Capture definition baseline before the agent stage.
- Add or select an open-schema prompt template that permits definition creation
  and active memory writes.
- Prompt the agent to reuse existing definitions when they fit and create new
  definitions only when needed.
- Write open-schema artifact paths into `mcp-agent-run.json` and
  `evaluation-run.json`.
- Update `evaluation-run.schema.json` for open-schema stage names and artifact
  paths without breaking known-schema runs. `evaluationMode:
  "mcp-open-schema"` is already reserved, but the stage enum and artifact maps
  still need to reflect `capture-definition-baseline`,
  `export-memory-snapshot`, `score-open-schema-database`, and
  `score-open-schema-combined`.
- Keep known-schema runner behavior and artifact names unchanged.
- Keep live Claude open-schema smoke reserved until Checkpoint 4 identity and
  schema-state isolation work.

Tests:

- CLI parsing accepts `--schema-mode open` and still rejects unsupported modes.
- Known-schema setup is skipped in open mode.
- Definition baseline is recorded.
- Prompt excludes hidden truth files and accepted slug maps.
- Partial failures skip later open-schema stages correctly.
- `mcp-agent-run.schema.json` accepts open mode and the new artifact paths.
- `evaluation-run.schema.json` accepts the open-schema stage list and artifact
  paths.
- Fake command-agent run completes all open-schema stages.

Stop point achieved:

- A non-live command-adapter run completes with valid open-schema artifacts.

### Checkpoint 4: Isolation And Live Smoke (pending)

Goal:

- Make the first live MCP open-schema run clearly labeled as smoke-only or
  benchmark-usable.

Implementation notes:

- Add the hard MCP/backend identity preflight before trusting live scores as
  benchmarks.
- Pick one definition-state strategy for benchmark runs: fresh user or guarded
  cleanup.
- If only baseline recording exists, run live smoke but label the artifacts and
  summary as contaminated-or-unknown schema state.
- Record a clear reliability label such as `benchmarkReliability:
  "smoke-only"` or `"benchmark-usable"` in the run artifacts. Prefer putting
  the label in `evaluation-run.json` and `mcp-agent-run.json`; keep
  `memory-snapshot.json` focused on raw facts such as identity verification,
  schema reset mode, and baseline strategy.
- Document whether the agent reused existing definitions, created new ones, or
  was affected by prior eval-owned definitions.

Verification:

- Targeted runner/scorer tests pass.
- `pnpm eval:verify` passes if the changed eval tests are included in the
  normal suite.
- One live Claude MCP smoke produces `memory-snapshot.json`,
  `open-schema-database-score-report.json`, `form-score-report.json`, and
  `open-schema-combined-score-report.json`.

Stop point:

- Open-schema MCP is usable for smoke runs, and the team knows what remains
  before treating live scores as benchmark-reliable.

### Checkpoint 5: Upload-Level Schema Discovery (pending)

Goal:

- Design product-native open-schema document upload only after MCP open-schema
  scoring is working.

Implementation notes:

- Decide whether upload should propose definitions, create definitions, or use
  a two-pass discovery/extraction flow.
- Keep the same `memory-snapshot.json` and open-schema scorers so MCP and
  backend upload producers are comparable at the artifact boundary.

Stop point:

- A separate implementation plan exists for upload-level schema discovery.

## Coordination Notes

- Backend/API: memory snapshot can start with existing GraphQL APIs. If creation
  timestamps or audit provenance are needed to identify run-created
  definitions, plan that as a backend addition rather than guessing in the
  scorer.
- Eval artifacts: add new schemas for `memory-snapshot`,
  `open-schema-database-score-report`, and `open-schema-combined-score-report`.
- Runner: open mode should share the existing MCP agent workspace, transcript,
  completion-marker checks, and partial `evaluation-run.json` behavior.
- Scoring: do not change known-schema `database-score-report.json` or
  `combined-score-report.json` unless a bug is discovered.
- Comparison tooling: `eval:compare-runs` can remain known-schema oriented for
  v1. A schema-aware open-schema comparison command is useful later, after live
  smoke artifacts show which summary fields are worth comparing repeatedly.
- Live operations: artifact roots can contain corpus PII and transcripts, so
  keep live smoke outputs out of commits unless explicitly curated.
