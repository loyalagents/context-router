# Single-Call Evaluation Wrapper Brainstorm

- Status: brainstorm
- Last updated: 2026-06-10

## Goal

Make the known-schema evaluation flow runnable with one command instead of
manually calling each stage.

Current manual chain:

```text
eval:validate --documents-root
  -> eval:ingest-documents
  -> eval:export-stored-preferences
  -> eval:score --mode database
  -> eval:fill-form
  -> eval:score --mode form
  -> eval:score --mode combined
```

The wrapper should preserve intermediate artifacts because they are useful for
debugging which stage failed: document validation, ingestion, storage export,
database scoring, form-fill, form scoring, or combined attribution.

This first wrapper should evaluate existing document files only. Corpus
generation remains a separate input-producing workflow.

## Key Constraints

- The wrapper should be a single orchestration call, not a new scoring or
  ingestion implementation.
- The wrapper should call existing `run*` functions directly rather than
  shelling out to `pnpm`.
- The wrapper should own orchestration. It should not use
  `ingest-documents --export-stored-preferences`,
  `ingest-documents --database-score-report`, or
  `fill-form --form-score-report`.
- Low scores are not failures. A low score is useful eval output. The wrapper
  should stop only on stage runtime/setup failures, represented by nonzero stage
  exit codes.
- `evaluation-run.json` should be the only new wrapper artifact and should have
  a schema.
- Auth tokens must never be written to disk.

## Documents Root

For committed corpora, the wrapper should default `--documents-root` to the
corpus root:

```text
examples/eval/users/<userId>/corpora/<corpusId>
```

This is important because manifest document paths already include
`documents/...`, and the ingestor resolves:

```text
documentsRoot + manifest.documents[].path
```

For generated previews or external document sets, callers can override
`--documents-root`:

```bash
--documents-root /private/tmp/alex-realistic-preview
```

## Validation Report Handling

The wrapper should always validate the exact document root it is about to
ingest and write:

```text
<artifacts-root>/validation-report.json
```

This matters because database scoring currently reads the committed corpus
report:

```text
examples/eval/users/<userId>/corpora/<corpusId>/validation-report.json
```

That is correct for committed corpora but wrong for preview or external
document roots. To make the wrapper correct for both cases, database scoring
should gain an explicit validation report input:

```bash
pnpm eval:score --mode database \
  --user <userId> \
  --corpus <corpusId> \
  --stored-preferences <file> \
  --validation-report <artifacts-root>/validation-report.json \
  --out <file>
```

Without this change, preview docs could validate successfully but scoring would
still use stale committed truth-readiness data.

## Approaches

### 1. Shell / pnpm Script Wrapper

Add a shell-style wrapper that invokes the existing commands in sequence.

Example:

```bash
pnpm eval:known-schema-e2e \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --documents-root examples/eval/users/alex-i9-test/corpora/realistic \
  --artifacts-root /private/tmp/alex-eval-run \
  --reset-memory
```

Pros:

- Fastest implementation.
- Easy to understand locally.
- Keeps existing commands untouched.

Cons:

- Harder to test cleanly.
- Shell quoting and env handling get brittle.
- Error handling is coarse.
- Resume or partial rerun behavior is awkward.
- Less consistent with the existing eval scripts, which are Node CLIs with
  importable `run*` functions.

Conclusion: avoid. The existing importable runners make a Node wrapper only a
small step up in complexity and a large step up in reliability.

### 2. Node CLI Wrapper That Imports Existing `run*` Functions

Add a new Node CLI that calls current scripts through their exported runner
functions:

- `runValidation`
- `runIngestDocuments`
- `runExportStoredPreferences`
- `runScore` for database scoring
- `runFillForm`
- `runScore` for form scoring
- `runScore` for combined scoring

Example:

```bash
pnpm eval:e2e-known-schema \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --artifacts-root /private/tmp/alex-eval-run \
  --reset-memory
```

Pros:

- Best fit with the current repo.
- Reuses existing stage behavior and validation.
- Testable with mocked runner functions.
- Can write one schema-validated `evaluation-run.json` summary.
- Preserves every intermediate artifact.
- Gives better stage-level error reporting than shell orchestration.
- Keeps low-but-valid scores flowing through to combined attribution.

Cons:

- More code than a shell wrapper.
- Requires careful argument plumbing.
- Needs an explicit failure and partial-summary policy.

Conclusion: recommended first implementation.

### 3. Extend `ingest-documents`

Add more options to the existing ingestor, such as:

```bash
pnpm eval:ingest-documents \
  ... \
  --fill-scenario alex-i9-realistic \
  --combined-score-report <file>
```

Pros:

- Smaller command surface.
- Ingestion already supports optional export and database scoring.
- Convenient for some standalone known-schema runs.

Cons:

- Makes the ingestor too broad.
- Couples document ingestion to form filling.
- Less reusable for manual, MCP, or open-schema flows where ingestion might not
  be the first stage.
- Blurs the artifact boundaries we intentionally created.
- The ingestor already has convenience export/database-score flags; the wrapper
  should not deepen that partial orchestration pattern.

Conclusion: avoid. The wrapper should own orchestration; the ingestor should
prepare backend memory only when used by the wrapper.

### 4. Generic Pipeline Runner With Config File

Add a generic pipeline command:

```bash
pnpm eval:pipeline --config examples/eval/runs/alex-known-schema.json
```

Example config:

```json
{
  "runId": "alex-known-schema",
  "userId": "alex-i9-test",
  "corpusId": "realistic",
  "scenarioId": "alex-i9-realistic",
  "documentsRoot": "examples/eval/users/alex-i9-test/corpora/realistic",
  "artifactsRoot": "/private/tmp/alex-known-schema",
  "stages": [
    "validate-documents",
    "ingest",
    "export",
    "score-database",
    "fill-form",
    "score-form",
    "score-combined"
  ]
}
```

Pros:

- Most extensible.
- Good for repeatable benchmark runs.
- Could later support MCP, manual, known-schema, and open-schema flows.
- Config files can document canonical eval recipes.

Cons:

- More architecture up front.
- Requires a config schema and stage model.
- Easy to overbuild before we have run enough live evals.

Conclusion: attractive later, but likely premature for the next PR. The
known-schema wrapper can be a clean precursor to this if more wrappers later
share the same stage model.

### 5. Separate Known-Schema And Open-Schema Wrappers

Add a known-schema wrapper now, then add MCP/open-schema wrappers later:

```bash
pnpm eval:e2e-known-schema
pnpm eval:e2e-mcp-agent
pnpm eval:e2e-open-schema-upload
```

Pros:

- Keeps the first wrapper simple.
- Avoids designing open-schema orchestration before we know the exact shape.
- Lets each benchmark track keep its own assumptions explicit.

Cons:

- Commands may diverge if common behavior is not factored carefully.
- We may eventually want shared runner utilities.

Conclusion: this pairs well with the Node CLI wrapper. Build known-schema first,
factor shared helpers only when the second runner arrives.

## Proposal

Build a Node CLI wrapper for the known-schema flow only.

Proposed command:

```bash
pnpm eval:e2e-known-schema \
  --user <userId> \
  --corpus <corpusId> \
  --scenario <scenarioId> \
  --artifacts-root <dir> \
  [--documents-root <dir>] \
  [--backend-url <url>] \
  [--graphql-url <url>] \
  [--auth-token <token>] \
  [--reset-memory] \
  [--run-id <id>]
```

Defaults:

- `--documents-root` defaults to
  `examples/eval/users/<userId>/corpora/<corpusId>`.
- `--backend-url` follows the existing backend URL default used by ingestor and
  form runner.
- `--graphql-url` follows the existing GraphQL URL default used by exporter.
- `--auth-token` falls back to `EVAL_AUTH_TOKEN`.
- `--run-id` is generated once by the wrapper when omitted.

The wrapper should write stable artifact names under `--artifacts-root`:

```text
<artifacts-root>/
  validation-report.json
  ingestion-run.json
  stored-preferences.json
  database-score-report.json
  filled-form.json
  filled-form.pdf
  form-fill-response.json
  form-fill-score-report.json
  combined-score-report.json
  evaluation-run.json
```

`evaluation-run.json` should be schema-validated and summarize:

- `runId`
- eval fixture user, corpus, scenario
- documents root
- backend URL and GraphQL URL with no secrets
- started and finished timestamps
- stage order
- stage status: `pending`, `passed`, `failed`, or `skipped`
- stage exit code, duration, console-safe lines, artifact paths, and nullable
  failure detail
- final database, form, and combined score summaries when available
- failure stage when a stage fails
- backend user id if already available from `ingestion-run.json` or exporter
  diagnostics

The wrapper should not add an extra backend identity call solely to populate
`backendUserId`; use identities already returned by stage artifacts.

## Stage Order

The wrapper should run these discrete stages:

```text
validate-documents
  -> ingest
  -> export
  -> score-database
  -> fill-form
  -> score-form
  -> score-combined
```

Stage details:

- `validate-documents`: call `runValidation` with `--documents-root` and
  `--report-out <artifacts-root>/validation-report.json`.
- `ingest`: call `runIngestDocuments` without its export or database-score
  convenience flags.
- `export`: call `runExportStoredPreferences`.
- `score-database`: call `runScore --mode database` with
  `--validation-report <artifacts-root>/validation-report.json` once that input
  exists.
- `fill-form`: call `runFillForm` without `--form-score-report`.
- `score-form`: call `runScore --mode form`.
- `score-combined`: call `runScore --mode combined`.

## Failure Policy

Default behavior should stop at the first nonzero stage exit code and still
write `evaluation-run.json`.

This means:

- Stop on validation failure.
- Stop on ingestion failure.
- Stop on export failure.
- Stop on database score command failure. This represents unscorable fixture
  readiness or runtime/schema failure, not a low score.
- Stop on form-fill failure.
- Stop on form score command failure.
- Run combined score only when both database and form score reports exist.

The wrapper should never stop because a produced score is low. Low-but-valid
scores are useful eval output and should flow through to combined attribution.

If CI-style score thresholds are needed later, add opt-in post-run gates such as
`--min-database-accuracy` after all stages run. Do not make score thresholds a
mid-pipeline default.

## Why This Proposal

The wrapper should make the common path easy without weakening the stage
boundaries that make the eval debuggable.

The existing individual commands are already valuable because each stage has its
own artifact:

- `validation-report.json` proves the document files match fixture truth before
  ingestion.
- `ingestion-run.json` explains upload/apply behavior.
- `stored-preferences.json` shows backend memory at the scoring boundary.
- `database-score-report.json` explains storage correctness.
- `filled-form.json` shows form output at the scoring boundary.
- `form-fill-score-report.json` explains form correctness.
- `combined-score-report.json` connects storage and form outcomes.

A Node wrapper can preserve those artifacts while removing manual command
typing. It also gives us a clean place to add an `evaluation-run.json` index, so
future humans or agents can inspect one file first and then drill into the
stage-specific artifacts.

## Test Ideas

- CLI help and missing required args.
- Env fallback and CLI override for backend URL, GraphQL URL, and auth token.
- Token never appears in `evaluation-run.json` or console lines.
- Stage order is exactly validate, ingest, export, database score, fill form,
  form score, combined score.
- Default artifact paths are derived from `--artifacts-root`.
- Default `--documents-root` points at the corpus root, not the nested
  `documents/` directory.
- Failure in each stage writes `evaluation-run.json` with later stages skipped.
- Score reports with low-but-valid scores continue to combined scoring.
- Combined scoring is skipped when either database or form report is absent.
- `evaluation-run.json` validates against its schema.
- The wrapper does not call ingestor export/database-score convenience flags.
- The wrapper does not call fill-form form-score convenience output.

## Deferred Work

- Generic config-driven pipeline runner.
- MCP/Codex/Claude open-schema runner.
- Upload-level schema-discovery runner.
- Resume-from-stage behavior.
- One-command corpus generation plus ingestion plus scoring. For now, generated
  documents should remain an input to this wrapper, not something it produces.
