# 100-Document Realistic Corpus Implementation Plan

- Status: planning
- Date: 2026-05-21
- Read when: implementing repeatable mass realistic document generation for `examples/eval/`

## Summary

Build one new 100-document realistic corpus for `samir-desai`, using the
existing eval fixture framework as deterministic rails and AI only for document
body drafting.

This creates a realistic committed fixture first. It does not, by itself, prove
document-extraction quality. The known-memory I-9 scenario in this plan proves
that the surrounding fixture and form-fill plumbing still works; a later
extraction runner is required before the 100 document bodies become a true
ingestion benchmark.

The output of the full implementation is:

- 100 newly generated realistic documents under
  `examples/eval/users/samir-desai/corpora/realistic/`
- Samir's existing 6-document `template-smoke` corpus preserved
- Elena's existing 100-document `realistic` corpus preserved
- 200 total realistic corpus documents across Elena and Samir after this lands

The generation path should not be "ask one agent to write 100 files in one
session." It should be:

```text
profile.yaml
  -> corpus-plan.json with 100 per-document specs
  -> AI writes one document body per isolated call
  -> deterministic validator checks metadata and prose
  -> committed corpus and known-memory form-fill scenario
  -> later extraction runner turns the fixture into an ingestion benchmark
```

No AI should run in `pnpm eval:test`, `pnpm eval:validate`, `pnpm eval:verify`,
or CI. AI is a local maintainer command used to produce committed fixtures.

## Current Implemented Baseline

Already implemented:

- `examples/eval/` is the canonical fixture home.
- `profile.yaml` is the source of truth for user facts.
- `seed-preferences.generated.json` is generated from profiles.
- `manifest.json` inventories corpus documents.
- `pnpm eval:validate` validates schemas, references, seed determinism, field
  maps, document inventory, and form coverage.
- `pnpm eval:scaffold` renders deterministic template-smoke corpora.
- `pnpm eval:run` runs deterministic backend form-fill snapshots through the
  backend test-app harness.
- I-9 has a field map and runner-owned snapshots.
- Elena has a 100-document hand-authored `realistic` corpus.
- Elena and Samir both have small deterministic `template-smoke` corpora.

Important current gaps:

- The validator trusts document `factKeys[]`; it does not verify that those
  fact values actually appear in document prose.
- There is no machine-readable 100-document corpus plan or distribution policy.
- There is no script that asks AI to generate realistic document bodies.
- The eval runner hydrates known memory directly from profile facts; it does not
  ingest documents through document analysis yet.

## Evaluation Of Existing 100-Doc Plans

### `a-100-doc-plan.md`

Agree:

- Use the current eval framework as rails around generated prose.
- Add `corpus-plan.json` and distribution validation.
- Generate documents in bounded batches instead of one freeform request.
- Keep document ingestion and extraction scoring separate from the first
  corpus-building step.
- Use a concrete distribution with meaningful noise and partial/conflicting
  documents.

Disagree:

- Document-text audit cannot wait until after the first 100-doc corpus. Once AI
  writes prose, validation must check the body, not only self-reported metadata.
- Pure coding-agent generation in 15-25 document batches still risks a shared
  house style inside each batch.
- `realistic-v1` is unnecessary for the first Samir corpus. Use `realistic`,
  matching Elena, and rely on schema versions for versioning.

### `b-100-doc-plan.md`

Agree:

- Scripts should be the reliability layer and agents/AI should be the variety
  layer.
- A small pilot before full generation is useful.
- Fuzzy prose checks should begin as warnings while they are calibrated.
- API-backed generation should not be wired into CI or normal validation.

Disagree:

- I would not defer script-called AI until after a manual full corpus. The
  script is valuable because it can isolate one call per document and keep the
  generation shape reproducible.
- A separate committed `realistic-pilot` corpus is not needed. Use a small
  generation preview for prompt tuning, then commit the final 100-doc corpus.

### `c-100-doc-plan.md`

Agree:

- Prose validation is the prerequisite. This is the most important point in the
  folder.
- Per-document specs or briefs are needed to avoid samey output.
- Elena's existing 100-document corpus is the right calibration target for the
  prose matcher.
- A manifest/spec stage should exist before document bodies are written.

Disagree:

- I would not introduce both coding-agent and API generation modes in the same
  first implementation. Build one provider seam and one initial backend.
- Direct Anthropic SDK should not be the default assumption for this repo
  because the repo already has Vertex AI dependencies and config.

### `d-100-doc-plan.md`

Agree:

- This is the strongest overall sequencing.
- Use one isolated AI call per document, not one long agent session.
- Keep AI out of validation, tests, and CI.
- Use `realistic` as the corpus id.
- Keep `corpus-plan.json` machine-readable and per-document writing guidance in
  the planned document entries.
- Add extraction evaluation only after the realistic corpus exists.

Disagree:

- Batch 1 as written is too large if it includes corpus-plan schema,
  distribution validation, per-document briefs, prose matching, calibration, and
  severity promotion all at once. Split the foundation into smaller checkpoints.
- Do not start with both `sdk` and `cli` call backends. Start with a single
  `vertex` backend because `@google-cloud/vertexai` and Vertex config already
  exist in the repo. Add a command backend later only if needed.
- Do not promote every prose integrity check to a hard error at once. Promote
  high-confidence identifiers first; keep fuzzy checks as warnings.

## Chosen Plan

### Target Corpus

Target user:

- `samir-desai`

Target corpus:

```text
examples/eval/users/samir-desai/corpora/realistic/
```

Target form:

- I-9, because the field map and deterministic runner already exist.

Final distribution:

| Category | Count | Role |
| --- | ---: | --- |
| `identity` | 15 | current identity facts and corroboration |
| `address-contact` | 15 | current and stale address/contact material |
| `work-authorization` | 12 | I-9 status and identifier support |
| `hr-onboarding` | 12 | employee onboarding context |
| `employer-context` | 8 | mostly Section 2 or employer guardrails |
| `partial-conflicting` | 18 | stale, partial, redacted, conflicting docs |
| `noise` | 20 | irrelevant files that should be ignored |

Total: 100 documents.

This first Samir corpus should omit `payroll-tax`; add that category when a
W-4 field map exists.

### Realism Bar

The corpus should be realistic text fixture data, not visual scanned PDFs.

Expected realism:

- varied file formats: `md`, `txt`, `json`, and `yaml`
- varied document voices: official transcript, HR note, email export,
  checklist, internal memo, account header, redacted snippet, personal notes
- documents that contain only some facts rather than every useful fact
- stale and conflicting documents that clearly signal they should not override
  current facts
- true noise documents with no high-confidence current identifiers
- natural placement of facts, not every value stacked in the first lines

Not required in this phase:

- scanned images
- OCR artifacts
- visual PDFs
- document-analysis ingestion scoring
- W-4, FAFSA, SF-86, SNAP, or rental-app coverage

### Corpus Plan And Manifest Ownership

For agent or AI-authored realistic corpora, `corpus-plan.json` is the single
authored per-document source of truth.

`manifest.json` is a generated, byte-stable projection from `corpus-plan.json`
plus the body files that actually exist. It should not be hand-edited for this
corpus.

The validator should add a plan/manifest drift check when both files exist,
using an issue such as `MANIFEST_PLAN_MISMATCH`, so overlapping metadata cannot
silently diverge. `brief` should stay plan-only. `challengeTags` should also
stay plan-only unless a later validator rule needs it in the manifest.

## How AI Will Be Called

Add a local maintainer command:

```bash
pnpm eval:generate --user samir-desai --corpus realistic
```

The command makes one independent AI call per planned document. For the full
corpus that means 100 generation calls, plus any deliberate regeneration calls
for failed documents.

Initial backend:

- `--backend vertex`
- uses the existing root `@google-cloud/vertexai` dependency
- uses `GCP_PROJECT_ID` and `VERTEX_REGION`
- requires an explicit `EVAL_GENERATION_MODEL` for committed corpus generation;
  do not silently rely on the backend default model
- pins generation temperature in the script so reruns are not wildly divergent
- supports a small configurable concurrency cap, defaulting conservatively

The generator should not call the backend app. It should call Vertex directly
from the eval script, because this is fixture generation, not product behavior.

Prompt shape per document:

```text
shared generation rules
profile slice containing only allowed facts for this document
corpus intentionallyMissing facts
one corpus-plan document entry with category, title, format, expectedUse,
authority, freshness, detailTier, factKeys, challengeTags, and brief
```

The model returns only the document body. It does not return manifest metadata.
Metadata is authored in `corpus-plan.json` and copied into `manifest.json` by
the script.

Generation rules:

- Do not invent current canonical facts.
- Place every listed fact key in the body.
- Do not include intentionally missing values.
- Noise docs must not include high-confidence current identifiers.
- Stale or conflicting docs must clearly show why they are stale or should not
  override current facts.

Validation then decides whether the output is acceptable. The generation script
must leave failed output on disk for review and exit non-zero when validation
fails.

Future optional backend:

- A command backend can later reuse the local-orchestrator style
  `--ai-command` contract for Claude or Codex CLI calls.
- Do not add that in the first pass unless Vertex generation is blocked.

## Checkpoints

### Checkpoint 1: Corpus Plan Contract

Goal: make the 100-document corpus reviewable before bodies exist.

Add:

- `examples/eval/schemas/corpus-plan.schema.json`
- validator support for `corpus-plan.json` when present
- optional `challengeTags[]` and `brief` fields in planned document entries
- a plan-only validation path, such as:

  ```bash
  pnpm eval:validate --user samir-desai --corpus realistic --plan-only
  ```

`--plan-only` semantics:

- require `corpus-plan.json`
- do not require `manifest.json`
- do not require document body files
- skip document-existence and prose checks
- validate profile references, form references, plan schema, category counts,
  path safety, uniqueness, fact keys, challenge tags, and distribution
- keep global template and form-map validation if that stays consistent with
  the current validator structure

`corpus-plan.json` should include:

- `schemaVersion`
- `targetDocumentCount`
- `categoryCounts`
- allowed `challengeTags`
- 100 `documents[]` entries with id, path, category, title, output format,
  expectedUse, authority, freshness, detailTier, intended fact keys,
  challenge tags, and brief

Validation rules:

- planned document count equals 100
- category counts sum to 100 and match planned entries
- paths are unique, relative, and under `documents/`
- fact keys resolve to profile leaves
- noise entries have empty `factKeys[]`
- `partial-conflicting` entries are not high-authority current extract docs
- if `manifest.json` also exists, it is a byte-stable generated projection of
  the plan and does not drift from overlapping plan metadata

Verification:

```bash
pnpm eval:test
pnpm eval:validate --user elena-marquez --corpus realistic
pnpm eval:verify
```

### Checkpoint 2: High-Confidence Prose Validation

Goal: validator opens document bodies and catches obvious fact drift.

Add a fact-value matcher in `examples/eval/scripts/shared.mjs` or a dedicated
module.

Start with high-confidence hard checks:

- email values
- SSN values, including digits-only variants
- USCIS/A-number values
- exact postal codes
- work email values

Add warning checks:

- exact street addresses, because abbreviations and unit rendering vary
- full legal names, because middle names and order can vary naturally
- date variants
- city and state mentions
- first/last name fragments
- common short values such as middle initials
- thin docs by `detailTier`
- repeated boilerplate
- undeclared profile values appearing in prose

New issue codes should include:

- `DOCUMENT_FACT_VALUE_MISSING`
- `DOCUMENT_MISSING_FACT_PRESENT`
- `DOCUMENT_UNDECLARED_FACT`
- `DOCUMENT_THIN`
- `DOCUMENT_BOILERPLATE`

Calibrate against Elena's existing 100-document `realistic` corpus. If Elena
fails on a fuzzy rule, tune the matcher or keep that rule as a warning.
Promote street-address or full-name checks to errors only after they pass Elena
and the Samir preview with low false-positive risk.

For null facts, `DOCUMENT_MISSING_FACT_PRESENT` must use fact-type-specific
patterns when no literal value exists. Example: if `contact.phone` is
intentionally null, flag phone-number-like text only when the document is not
explicitly stale, third-party, or guardrail context.

Verification:

```bash
pnpm eval:test
pnpm eval:validate --user elena-marquez --corpus realistic --write-report
pnpm eval:verify
```

### Checkpoint 3: Samir 100-Document Plan

Goal: author the full corpus spec before generating prose.

Work:

- Expand `samir-desai/profile.yaml` only if the realistic corpus needs more
  explicit stale, historical, or third-party facts.
- Keep current canonical facts authoritative.
- Add null facts for values that must remain blank.
- After any profile edit, run `pnpm eval:derive-seeds` and revalidate Samir's
  existing `template-smoke` corpus and scenario before continuing.
- Add `examples/eval/users/samir-desai/corpora/realistic/corpus-plan.json`
  with exactly 100 planned entries.
- Author `intentionallyMissing[]` in `corpus-plan.json`; the generated manifest
  receives the same entries.
- Define concrete challenge tags before body generation starts, including
  `stale-address`, `former-name`, `redacted-id`, `third-party-phone`,
  `employer-address-not-user-address`, and `sample-id-ignore`.
- Do not hand-author `manifest.json`. It is generated only when document
  bodies are ready; do not make normal full validation pass by pretending
  missing bodies exist.
- Update `examples/eval/PLAYBOOK.md` with the 100-doc workflow and prompt
  contract.

Verification:

```bash
pnpm eval:derive-seeds
pnpm eval:validate --user samir-desai --corpus template-smoke
pnpm eval:validate --scenario samir-desai-i9-template-smoke
pnpm eval:validate --user samir-desai --corpus realistic --plan-only
pnpm eval:test
```

### Checkpoint 4: AI Generation Command And Preview

Goal: add the local generation command and prove the prompt with a small
preview before generating the committed corpus.

Add:

- `examples/eval/scripts/generate.mjs`
- root script `eval:generate`
- tests for prompt construction, provider argument validation, body writing,
  skip-existing behavior, concurrency limits, manifest projection, and
  validation failure behavior

CLI shape:

```bash
pnpm eval:generate --user samir-desai --corpus realistic --backend vertex --model "$EVAL_GENERATION_MODEL"
pnpm eval:generate --user samir-desai --corpus realistic --backend vertex --model "$EVAL_GENERATION_MODEL" --limit 5 --out /private/tmp/samir-preview
pnpm eval:generate --user samir-desai --corpus realistic --backend vertex --model "$EVAL_GENERATION_MODEL" --concurrency 2 --regenerate 017,042
```

Behavior:

- Read `corpus-plan.json`.
- Generate one document body per planned document.
- Skip existing body files unless `--regenerate` is set.
- Write only files under `documents/`.
- Produce byte-stable `manifest.json` from the plan and existing generated body
  files.
- Run focused validation after generation.
- Leave generated files on disk when validation fails.
- Never run from CI.
- Require an explicit model for committed corpus generation.
- Use a configurable concurrency cap; default to a low value.

Prompt tuning:

- First generate 5 preview files to a temp output directory.
- Review style and validation signal.
- Do not commit the preview output.

Preview acceptance criteria:

- 5 preview docs cover at least 3 categories.
- high-confidence validation passes or failures are explainable.
- documents are not all structured the same way.
- no current canonical facts are invented.
- noise docs avoid high-confidence identifiers.
- stale/conflicting docs clearly signal stale/conflicting status.

Verification:

```bash
pnpm eval:test
pnpm eval:generate --user samir-desai --corpus realistic --backend vertex --model "$EVAL_GENERATION_MODEL" --limit 5 --out /private/tmp/samir-preview
```

### Checkpoint 5: Full Samir Realistic Corpus

Goal: generate, review, repair, and commit the 100 document corpus.

Work:

- Generate all 100 document bodies from the approved plan.
- Commit generated documents only after validation passes.
- Commit `corpus-plan.json`, generated `manifest.json`, and
  `validation-report.json`.
- Review any validation warnings before accepting the corpus.

Verification:

```bash
pnpm eval:generate --user samir-desai --corpus realistic --backend vertex --model "$EVAL_GENERATION_MODEL"
pnpm eval:validate --user samir-desai --corpus realistic --write-report
pnpm eval:test
```

### Checkpoint 6: Scenario And Snapshot

Goal: prove the new scenario and form-fill fixture plumbing work with the
existing deterministic form-fill runner.

Add:

```text
examples/eval/scenarios/samir-desai-i9-realistic/
  scenario.json
  start/prompt.md
  expected/filled-form.json
```

Run:

```bash
pnpm eval:validate --scenario samir-desai-i9-realistic
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm eval:run --scenario samir-desai-i9-realistic --update-snapshots
pnpm eval:run --scenario samir-desai-i9-realistic
pnpm eval:verify
```

Expected runner behavior should match Samir's known-memory profile, not the
document body contents. Document ingestion remains a later evaluation layer.
This scenario would not prove extraction quality; it proves deterministic
form-fill behavior from known memory.

Before committing `expected/filled-form.json`, review the snapshot diff by
field index, expected value, actual decoded value, classification, and skip
reason. The second normal `eval:run` proves determinism only after that review.

### Checkpoint 7: Extraction Evaluation Design

Goal: after the corpus exists, plan actual document-ingestion scoring.

Do not block the 100-document corpus on this checkpoint.

Next design:

- `expected/extracted-facts.json`
- a runner path that ingests documents through the existing backend
  document-analysis flow
- scoring for correct facts, missing facts, false positives, stale facts treated
  as current, invented null facts, and noise leakage

This later runner will call AI through the backend's existing Vertex-backed
document-analysis path, likely one analysis call per document.

### Checkpoint 8: Future TODO Capture

Goal: keep deferred expansion work visible after the 100-document corpus plan
starts moving.

Update `docs/plans/evaluation/user-generation-forms/TODO.md` with future steps
that are intentionally out of scope for the first Samir realistic corpus:

- richer generated file types, such as `.ics`, `.eml`, `.csv`, `.tsv`, `.vcf`,
  `.toml`, `.ini`, or HTML-like exports
- the validation, local-orchestrator discovery, backend upload MIME, and
  document-analysis support needed before those file types become ingestion
  eval fixtures instead of just local text fixtures
- an optional command-backed generation provider that can call Claude CLI,
  Codex CLI, or another local tool through a stable stdin/stdout contract
- a decision point for whether Vertex remains the only supported first-party
  generation backend after the initial corpus is generated

This TODO update should happen before marking the implementation batch complete,
so the future work does not get buried inside this plan.

### Checkpoint 9: Closeout

Goal: finish the implementation using the repo's planning workflow.

Work:

- Add `implementation-summary.md` in this `100-doc-goal/` folder.
- Register or update the 100-document initiative status in
  `docs/plans/evaluation/user-generation-forms/orchestration-plan.md`.
- Record commands run, AI generation model used, generation call count,
  validation status, snapshot review notes, and known deferred work.
- Run final no-DB verification.

Verification:

```bash
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Acceptance Criteria

The 100-doc initiative is done when:

- Samir has exactly 100 new documents under `corpora/realistic/documents/`.
- The distribution matches the planned 15/15/12/12/8/18/20 category split.
- At least 20 documents are true noise.
- At least 18 documents are partial, stale, conflicting, redacted, or
  guardrail documents.
- `corpus-plan.json` is the authored source, and generated `manifest.json`
  matches it byte-stably.
- `corpus-plan.json`, generated `manifest.json`, and `validation-report.json`
  are committed.
- Full validation passes with no errors.
- High-confidence prose checks are active.
- A known-memory I-9 `filled-form` scenario passes after its snapshot is
  reviewed; this proves form-fill plumbing, not extraction quality.
- `TODO.md` records the future file-type and generation-backend follow-ups.
- `implementation-summary.md` and `orchestration-plan.md` are updated.
- No AI call is required for validation, tests, runner snapshots, or CI.

## Non-Goals

- No deterministic 100-document template generator.
- No replacement of the existing template-smoke corpora.
- No W-4 work.
- No new backend product feature.
- No UI/browser automation.
- No document-ingestion scoring before the 100-document corpus exists.
- No real AI in CI.

## Risks

- Prose matching can produce false positives. Keep fuzzy checks as warnings and
  promote only high-confidence checks to errors.
- AI may produce plausible but wrong facts. The prompt slices facts narrowly,
  and the validator must block high-confidence drift.
- Generated documents may still feel samey. One isolated call per document plus
  per-document briefs should reduce this; review the first 5 preview files
  before generating all 100.
- Vertex credentials may not be available locally. If this blocks generation,
  add the command backend as a follow-up rather than weakening validation.
