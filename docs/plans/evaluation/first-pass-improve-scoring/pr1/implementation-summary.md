# PR 1 Implementation Summary: Eval Ingestor Overwrite Safety

- Status: implemented
- Last updated: 2026-06-15

## Summary

Implemented manifest-driven overwrite safety in the known-schema eval ingestor.
The backend remains unchanged. The ingestor now classifies every backend
suggestion before apply, records the decision in `ingestion-run.json`, and only
passes approved suggestions to `applyPreferenceSuggestions`.

## Behavior

- `ingestion-run.json` is now `schemaVersion: 2`.
- Blank suggestions are skipped before apply when `newValue` is `null`,
  `undefined`, `""`, or a whitespace-only string.
- `factContractDefaults.forbid` and per-document `factContract.forbid` block
  suggestions by canonical or accepted alias slug, even when the target is
  unset.
- Low-trust documents can first-write values, but cannot overwrite a non-empty
  in-memory value with a different value.
- Low-trust detection uses manifest metadata from `evaluationRole` and
  `sourceSpec`, with punctuation-insensitive label normalization.
- Explicit `--seed-preferences` values seed the in-memory state map after
  successful `setPreference` calls.
- The active-state map updates only after a full successful apply response, so
  the existing partial-apply hard failure invariant remains intact.

## Artifact Contract

Each document now records `suggestionDecisions[]`. Decisions include document
identity, slug, `newValue`, optional `existingValue`, decision
`applied|skipped|blocked`, canonical reasons, low-trust diagnostics, and
overwrite flags.

The run summary adds:

- `overwriteCount`
- `blankSuggestionSkippedCount`
- `forbiddenSuggestionBlockedCount`
- `staleOrNoiseOverwriteBlockedCount`

## Verification

Passed:

```bash
node --test examples/eval/scripts/ingest-documents.test.mjs
node --test examples/eval/scripts/e2e-known-schema.test.mjs
pnpm eval:test
pnpm eval:validate
```

`pnpm eval:validate` still reports the existing Alex realism warnings, but no
hard validation errors.
