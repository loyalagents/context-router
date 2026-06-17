# Open-Schema PR2 Static Scoring Implementation Plan

- Status: implemented
- Last updated: 2026-06-17

## Goal

Add Checkpoint 2 for open-schema evaluation: deterministic scoring over PR1's
`memory-snapshot.json` artifact.

PR2 keeps the implementation static-artifact only. It scores exported memory and
joins that result with the existing form score report, but it does not enable
MCP `--schema-mode open`, live agent runs, or backend upload-level schema
discovery.

## Non-Goals

- Do not change known-schema `stored-preferences.json`.
- Do not change known-schema `database-score-report.json` or
  `combined-score-report.json` contracts.
- Do not enable live MCP open mode.
- Do not add backend APIs or mutate backend state.
- Do not auto-correct values, slugs, definitions, or form output during
  scoring.
- Do not add LLM or human schema-quality judgment to deterministic headline
  scoring.

## Command Contract

Open-schema database scoring:

```bash
pnpm eval:score \
  --mode open-schema-database \
  --user <userId> \
  --corpus <corpusId> \
  --memory-snapshot <file> \
  [--validation-report <file>] \
  --out <file>
```

Open-schema combined scoring:

```bash
pnpm eval:score \
  --mode open-schema-combined \
  --open-schema-database-report <file> \
  --form-report <file> \
  --out <file>
```

## Artifact Contracts

Add:

- `examples/eval/schemas/open-schema-database-score-report.schema.json`
- `examples/eval/schemas/open-schema-combined-score-report.schema.json`

The database report uses `scoreType:
"open-schema-database-storage"` and reads:

- fixture profile, manifest, storage map, and validation report;
- PR1 `memory-snapshot.json`;
- active memory preferences;
- optional suggestions;
- exported definitions and `definitionBaseline`.

The combined report uses `scoreType: "open-schema-combined"` and reads:

- `open-schema-database-score-report.json`;
- the existing `form-fill-score-report.json`.

## Scoring Behavior

Known-present facts headline active-memory value recovery:

- `open_known_present_recovered_accepted_slug`
- `open_known_present_recovered_novel_slug`
- `open_known_present_suggestion_only`
- `open_known_present_wrong_value`
- `open_known_present_missing`

Accepted/canonical/alias slug matches are retained as diagnostics. Suggestions
are diagnostic except for the explicit known-present `suggestion_only` bucket.

Intentionally missing facts headline active-memory hallucination:

- `open_missing_absent_correct`
- `open_missing_active_value_hallucinated`
- `open_missing_active_key_hallucinated`
- `open_missing_active_hallucinated`

Schema diagnostics stay deterministic:

- definition counts;
- copied baseline ID/slug diffs;
- duplicate slug groups;
- empty description definitions;
- preference and suggestion rows whose `definitionId` is missing from exported
  definitions;
- unscored active preferences and suggestions.

## Implementation Checkpoints

1. Add open-schema database scoring.
   - Validate `memory-snapshot.json`.
   - Require `userId` and `corpusId` to match CLI inputs.
   - Reuse known-schema fixture-readiness and fact collection logic.
   - Score active-memory recovery and missing-fact hallucination.
   - Add deterministic schema diagnostics.

2. Add open-schema combined scoring.
   - Validate open-schema database and existing form reports.
   - Require report identity to match.
   - Join by `factKey`.
   - Headline form outcome plus memory value recovery, not strict slug
     correctness.

3. Wire `pnpm eval:score`.
   - Add `open-schema-database` and `open-schema-combined` modes.
   - Keep existing known-schema modes unchanged.

4. Add focused tests.
   - Cover CLI help and required args.
   - Cover schema-valid output.
   - Cover accepted slug recovery, novel slug recovery, suggestion-only
     recovery, wrong values, missing known facts, conflicts, missing-fact
     hallucinations, suggestion-only missing diagnostics, unscored rows, and
     schema diagnostics.
   - Cover open combined attribution across recovered, missing,
     suggestion-only, missing-absent, missing-hallucinated, and not-scored
     memory states.
   - Keep known-schema score CLI tests passing unchanged.

5. Documentation closeout.
   - Add this plan and PR2 implementation summary.
   - Update open-schema orchestration, scoring orchestration, and scoring TODO.

## Verification Commands

```bash
node --test examples/eval/scripts/scoring/open-schema-database.test.mjs examples/eval/scripts/scoring/open-schema-combined.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Rollback Notes

Remove the open-schema scorer modules, open-schema report schemas, score CLI
mode wiring, PR2 tests, and PR2 docs. The known-schema scorer/exporter artifacts
should not need rollback because PR2 does not change their report contracts.
