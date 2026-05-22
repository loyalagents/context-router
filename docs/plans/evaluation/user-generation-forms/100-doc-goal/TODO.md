# 100-Document Goal TODO

## Current State

The initial cleanup pass has been implemented locally.

Now available:

- `nina-meera-patel` has a 100-document `realistic` corpus.
- The corpus uses mixed file types:
  - 45 `md`
  - 25 `txt`
  - 20 `json`
  - 10 `yaml`
- `corpus-plan.json` has stronger file-type-aware briefs.
- `pnpm eval:manifest` projects `corpus-plan.json` to `manifest.json` without AI or Vertex env.
- `pnpm eval:generate --ids ... --out ...` supports mixed cross-category previews.
- `pnpm eval:generate --overwrite` provides an explicit full replacement path.
- `--regenerate` and `--ids` accept short sequence ids such as `001`.
- The validator parses `.json`, parses `.yaml`, rejects structured files wrapped in Markdown fences, and warns when `.txt` files look like Markdown.
- Focused validation passes with 0 errors and 0 warnings.

## Still Not Done

The full 100-document Vertex regeneration has not been run in the Codex shell because this shell does not have Vertex env values:

- `GCP_PROJECT_ID`
- `EVAL_GENERATION_MODEL`
- optional `VERTEX_REGION`

The current mixed corpus body files are deterministic local fixture bodies, with JSON/YAML/TXT wrappers where appropriate. They validate and are useful for tooling tests, but they are not yet the final Vertex-authored high-realism corpus.

## Next Action

Run a mixed Vertex preview from a shell that has the Vertex env configured:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031,043,055,063,081 --out /private/tmp/nina-mixed-preview
```

Review the preview for:

- valid JSON and YAML
- no Markdown fences in structured outputs
- plain `.txt` style
- no invented phone number
- no invented work authorization identifiers
- no high-confidence identifiers in noise docs
- enough variation across categories

If preview quality is acceptable, run full regeneration:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --backend vertex --overwrite --concurrency 2
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:verify
```

## Future File Types

Do not add richer file types until the current mixed text/structured corpus is reviewed.

Deferred file types:

- `.ics`
- `.eml`
- `.csv`
- `.tsv`
- `.vcf`
- HTML-like exports
- PDF
- image/scanned documents

Those require more than plan edits:

- schema updates
- validator updates
- MIME/upload decisions
- document-analysis ingestion support
- parser/rendering expectations

## Corpus Truth Validation Before Extraction

Before this corpus becomes an extraction benchmark, add stronger corpus-truth validation:

- Track validation design and implementation follow-ups in
  [`../validation/TODO.md`](../validation/TODO.md). Keep this section as the
  100-document corpus reminder, not the detailed validation backlog.
- documents that claim a fact actually contain that fact's value in the body
- documents that must omit a fact do not contain that fact's value
- intentionally missing facts are absent from document bodies, not only absent from `factKeys[]`
- noise documents do not leak high-confidence current user identifiers
- stale, conflicting, partial, or guardrail documents are clearly marked as non-authoritative

Possible schema direction:

- keep `factKeys[]` as the list of facts expected to appear
- add document-level `forbiddenFactKeys[]` or equivalent exclusion metadata
- add value variants for SSN, dates, A-numbers, addresses, and units
- keep fuzzy checks as warnings until calibrated

## Benchmark Work Later

After the documents are Vertex-authored and reviewed:

- add an expected filled-form snapshot for `nina-meera-patel-i9-realistic`
- design `expected/extracted-facts.json`
- build a document-ingestion extraction runner
- score correct facts, missing facts, stale-fact leakage, invented values, and noise leakage

The current fixture validates corpus structure and document truth checks. It still does not evaluate extraction quality.

## Documentation Cleanup TODO

Move `COMMANDS.MD` somewhere more permanent after the workflow stabilizes, likely under `examples/eval/` or `docs/plans/evaluation/user-generation-forms/`.
