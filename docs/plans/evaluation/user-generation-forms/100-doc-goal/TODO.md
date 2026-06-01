# 100-Document Goal TODO (Historical, Closed)

## Status Update

This track is closed as a historical record. It has been superseded by the
smaller modular workflow under `../10-automatic/user-corpus/`.

The active 100-document Nina and Elena realistic corpora were pruned from
`examples/eval`, so commands in this file that reference `nina-meera-patel`,
`elena-marquez/corpora/realistic`, or `nina-meera-patel-i9-realistic` are
historical notes only. Do not run them against the current fixture tree.

Current realistic corpus work uses a unified V2 `manifest.json`; the old split
plan/projection workflow has been retired.

## Historical State Before Supersession

The initial cleanup pass had been implemented locally before this track was
superseded.

At that time:

- `nina-meera-patel` had a 100-document `realistic` corpus.
- The corpus uses mixed file types:
  - 45 `md`
  - 25 `txt`
  - 20 `json`
  - 10 `yaml`
- The historical split plan file had stronger file-type-aware briefs.
- A retired manifest projection command converted that plan file to
  `manifest.json` without AI or Vertex env.
- `pnpm eval:generate --ids ... --out ...` supports mixed cross-category previews.
- `pnpm eval:generate --overwrite` provides an explicit full replacement path.
- `--regenerate` and `--ids` accept short sequence ids such as `001`.
- The validator parses `.json`, parses `.yaml`, rejects structured files wrapped in Markdown fences, and warns when `.txt` files look like Markdown.
- Focused validation passed with 0 errors and 0 warnings.

## Historical Remaining Work

The full 100-document Vertex regeneration had not been run in the Codex shell
because that shell did not have Vertex env values:

- `GCP_PROJECT_ID`
- `EVAL_GENERATION_MODEL`
- optional `VERTEX_REGION`

The mixed corpus body files were deterministic local fixture bodies, with
JSON/YAML/TXT wrappers where appropriate. They validated and were useful for
tooling tests, but they were not the final Vertex-authored high-realism corpus.

## Generation Quality Perspective

Treat generated documents as needing two separate gates:

- **Correctness gate:** every declared high-confidence `factKey` must appear in the body in a deterministic, validator-recognizable form, and every forbidden/missing fact must stay out of the body.
- **Realism gate:** the body should read like a plausible source artifact, not like a tidy synthetic fact carrier.

Recent Vertex previews show that those gates can fail independently. A document can contain the right human-readable idea while still failing corpus-truth validation because the exact value variant is not provable. For example, `PATEL, NINA MEERA` may be understandable as the legal name, but it does not prove `Nina Meera Patel` unless the validator supports that variant. Likewise, split I-9 name fields do not prove the combined `identity.legalName` fact.

The opposite failure is also possible: a document can pass the deterministic checks while still looking fake. Common realism problems to watch for:

- generic Markdown field/value blocks across too many documents
- placeholder text such as `Current Date` or `(To be completed)`
- very short documents that only exist to carry facts
- over-clean labels and perfect formatting
- invented but flat institutions, account numbers, and addresses
- contradictory timeline details, such as an expired lease marked active
- too many canonical user facts packed into a document type that would not naturally include them

Do not solve the realism problem by only making the validator more permissive. The generator needs stronger document archetypes and a repair loop.

Historical recommended direction, translated to the current V2 manifest shape:

- Strengthen manifest `sourceSpec` entries with document-specific source context, length/texture expectations, allowed invented surrounding details, and explicit canonical anchors for validator-backed facts.
- Make the prompt require each declared fact to appear at least once in an exact or validator-supported value form, even if the document also includes realistic alternate formatting.
- Add a generate/validate/repair loop: preview documents, run corpus-truth validation, feed per-document failures back into targeted regeneration, and only write to the committed corpus after the preview passes both correctness and realism review.
- Capture this as a workflow/playbook first. A Codex skill can come later once the workflow is stable.

## Historical Next Action (Do Not Run)

This was the next action before the track was superseded. Do not run this
against the current fixture tree because `nina-meera-patel` has been removed.

The historical command was:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031,043,055,063,081 --out /private/tmp/nina-mixed-preview
```

Review the preview for:

- declared facts appear in validator-recognizable forms
- valid JSON and YAML
- no Markdown fences in structured outputs
- plain `.txt` style
- no invented phone number
- no invented work authorization identifiers
- no high-confidence identifiers in noise docs
- enough variation across categories
- no placeholder text or contradictory current/stale signals
- documents read like plausible source artifacts, not generic synthetic templates

If preview quality was acceptable, the historical full-regeneration path was:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --backend vertex --overwrite --concurrency 2
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:verify
```

## Historical Future File Types

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

## Historical Corpus Truth Validation Before Extraction

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

## Historical Benchmark Work Later

After the deleted 100-document corpus documents were Vertex-authored and
reviewed, this track would have needed:

- add an expected filled-form snapshot for `nina-meera-patel-i9-realistic`
- design `expected/extracted-facts.json`
- build a document-ingestion extraction runner
- score correct facts, missing facts, stale-fact leakage, invented values, and noise leakage

The current fixture validates corpus structure and document truth checks. It still does not evaluate extraction quality.

## Documentation Cleanup TODO

Move `COMMANDS.MD` somewhere more permanent after the workflow stabilizes, likely under `examples/eval/` or `docs/plans/evaluation/user-generation-forms/`.
