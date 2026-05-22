# Initial Clean-Up 1 Implementation Summary

- Status: implemented locally; live Vertex full regeneration pending
- Date: 2026-05-22
- Read when: reviewing the mixed-file cleanup after `initial-try-0`

## Summary

This cleanup implemented the tooling and corpus changes needed before regenerating the 100-document Nina fixture with Vertex.

The corpus is no longer Markdown-only. It now has mixed file types, stronger per-document briefs, manifest projection tooling, short-id preview/regeneration support, overwrite generation support, and file-type validation.

The only planned step not run in this shell is full live Vertex regeneration, because the Codex shell does not currently have Vertex env values set.

## What Changed

Tooling:

- Added `examples/eval/scripts/manifest.mjs`.
- Added root script `pnpm eval:manifest`.
- Added no-AI manifest projection from `corpus-plan.json` to `manifest.json`.
- Updated `examples/eval/scripts/generate.mjs` to support `--ids`.
- Updated `--regenerate` to accept short ids like `001`.
- Added `--overwrite` for full in-place regeneration even when body files already exist.
- Added file-type-specific prompt instructions for `md`, `txt`, `json`, and `yaml`.
- Added defensive code-fence stripping for generated `json`, `yaml`, and `txt` output.
- Updated generator tests.

Corpus:

- Updated `examples/eval/users/nina-meera-patel/corpora/realistic/corpus-plan.json`.
- Renamed body files to mixed extensions.
- Regenerated `manifest.json`.
- Refreshed `validation-report.json`.
- Replaced generic briefs with file-type-aware generation guidance.

Validator:

- `.json` document bodies must parse as JSON.
- `.yaml` document bodies must parse as YAML.
- `.json` and `.yaml` bodies cannot be wrapped in Markdown code fences.
- `.txt` bodies warn when they look like Markdown.
- Added validator tests for these checks.

Docs:

- Updated `100-doc-goal/TODO.md`.
- Updated `100-doc-goal/COMMANDS.MD`.
- Added this summary.

## Current Corpus Shape

The Nina realistic corpus still has exactly 100 documents.

File-type distribution:

| Extension | Count |
| --- | ---: |
| `md` | 45 |
| `txt` | 25 |
| `json` | 20 |
| `yaml` | 10 |

Category distribution stayed the same:

| Category | Count |
| --- | ---: |
| `identity` | 15 |
| `address-contact` | 15 |
| `work-authorization` | 12 |
| `hr-onboarding` | 12 |
| `employer-context` | 8 |
| `partial-conflicting` | 18 |
| `noise` | 20 |

## Verification

Commands run:

```bash
node --test examples/eval/scripts/generate.test.mjs
node --test examples/eval/scripts/validate.test.mjs
pnpm eval:manifest --user nina-meera-patel --corpus realistic
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
```

Results:

- generator tests passed
- validator tests passed
- focused Nina validation passed
- focused Nina validation reported 0 errors and 0 warnings

Full `pnpm eval:verify` should still be run before merge after final doc updates are complete.

## Vertex Status

Full Vertex regeneration was not run from this shell.

Reason:

- no `GCP_PROJECT_ID`
- no `EVAL_GENERATION_MODEL`
- no `VERTEX_REGION`

Next command to run from a configured shell:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031,043,055,063,081 --out /private/tmp/nina-mixed-preview
```

If the mixed preview is acceptable:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --backend vertex --overwrite --concurrency 2
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:verify
```

## Remaining Work

Still deferred:

- run and review mixed Vertex preview
- run full Vertex regeneration
- add expected filled-form snapshot for `nina-meera-patel-i9-realistic`
- design document-ingestion extraction scoring
- add richer file types such as `.ics`, `.eml`, `.csv`, `.vcf`, HTML, PDFs, or scans

The current result is a stronger validated corpus fixture and generation workflow. It is still not an extraction benchmark.
