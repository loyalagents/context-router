# PR 1 Implementation Plan: Eval Ingestor Overwrite Safety

- Status: implementation plan
- Last updated: 2026-06-15

## Goal

Keep overwrite-safety policy in the known-schema eval ingestor. The backend
continues to upload documents and return suggestions; the ingestor classifies
each suggestion before apply, records every decision, and applies only safe
suggestions.

## Checkpoint 1: Tests First

- Add ingestor tests for blank and whitespace skips, forbidden blocks, low-trust
  first writes, low-trust overwrite blocks, seeded-value protection, allowed
  high-authority overwrites, and counter semantics.
- Verify the tests fail against the current implementation before changing
  behavior.

Run:

```bash
node --test examples/eval/scripts/ingest-documents.test.mjs
```

## Checkpoint 2: Suggestion Decision Layer

- Add an in-memory active-state map keyed by slug.
- Seed the map only from explicit `--seed-preferences` rows after successful
  `setPreference` calls.
- Build a slug policy map from manifest facts and `fact-storage-map.v1.json` so
  `factContract.forbid` can block canonical and accepted alias slugs.
- Classify every upload suggestion before building `applyInput`.
- Treat `null`, `undefined`, and whitespace-only strings as blank.
- Treat low-trust documents as unable to overwrite non-empty state, while still
  allowing first writes.

Run:

```bash
node --test examples/eval/scripts/ingest-documents.test.mjs
```

## Checkpoint 3: Artifact Contract

- Bump `ingestion-run.json` to `schemaVersion: 2`.
- Add `suggestionDecisions`, skipped/blocked diagnostics, applied overwrite
  diagnostics, and summary counters.
- Keep the report strict; old v1 artifacts do not need compatibility.
- Update the known-schema E2E wrapper tests only where they consume the expanded
  ingestion summary.

Run:

```bash
node --test examples/eval/scripts/ingest-documents.test.mjs
node --test examples/eval/scripts/e2e-known-schema.test.mjs
```

## Checkpoint 4: Documentation Closeout

- Write `implementation-summary.md`.
- Update the first-pass TODO and orchestration docs to mark PR 1 complete and
  describe the shipped artifact contract.

Run:

```bash
pnpm eval:test
pnpm eval:validate
```
