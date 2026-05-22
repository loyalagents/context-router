# Initial Clean-Up 1 Implementation Plan

- Status: planning
- Date: 2026-05-22
- Read when: updating the first 100-document fixture to use mixed file types and stronger per-document briefs

## Summary

The first 100-document fixture works and validates, but it is too Markdown-heavy and the per-document briefs are too generic.

This cleanup pass updates the Nina realistic corpus so Vertex has better instructions before full 100-document regeneration.

Target corpus:

```text
examples/eval/users/nina-meera-patel/corpora/realistic/
```

Primary goals:

- use mixed `md`, `txt`, `json`, and `yaml` document types
- strengthen every document brief
- add manifest-only projection tooling
- add a supported full-replacement path for Vertex regeneration
- improve mixed preview selection
- keep validation green at stable checkpoints
- preview mixed Vertex output before full regeneration

Non-goals for this cleanup:

- no `.ics`, `.eml`, `.csv`, `.tsv`, `.vcf`, PDF, image, or HTML support yet
- no extraction benchmark yet
- no expected filled-form snapshot yet
- no backend document ingestion work

## Current State

Implemented baseline:

- `corpus-plan.json` exists
- `manifest.json` exists
- 100 deterministic body files exist
- validation passes
- `pnpm eval:verify` passes
- Vertex preview for the first five docs works

Current problem:

```text
planned extensions: { md: 100 }
```

That makes Vertex generate clean Markdown-style documents. The output is fact-correct, but not realistic enough.

## Review Feedback Incorporated

This plan incorporates `implementation-feedback-1.md`.

Key changes from the first draft:

- body-vs-extension validator tightening moves after full Vertex regeneration
- manifest projection becomes explicit tooling, not an implied side effect
- full regeneration gets a supported overwrite path before it is needed
- preview selection and regeneration share one id resolution mechanism
- risks, rollback, and closeout are now explicit checkpoints
- validator behavior includes required tests, not just commands to run

## Target File-Type Distribution

Use only file types already allowed by `corpus-plan.schema.json`:

| Extension | Count | Role |
| --- | ---: | --- |
| `md` | 45 | letters, notes, emails, memos, narrative records |
| `txt` | 25 | OCR-like text, transcripts, raw exports, receipts |
| `json` | 20 | HRIS exports, portal dumps, system records |
| `yaml` | 10 | checklists, internal summaries, compliance notes |

Total: 100 documents.

Suggested category-level allocation:

| Category | Count | `md` | `txt` | `json` | `yaml` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `identity` | 15 | 7 | 3 | 3 | 2 |
| `address-contact` | 15 | 5 | 4 | 4 | 2 |
| `work-authorization` | 12 | 5 | 3 | 2 | 2 |
| `hr-onboarding` | 12 | 5 | 2 | 3 | 2 |
| `employer-context` | 8 | 3 | 2 | 2 | 1 |
| `partial-conflicting` | 18 | 10 | 6 | 1 | 1 |
| `noise` | 20 | 10 | 5 | 5 | 0 |

This keeps Markdown as the largest type while forcing enough structured and plain-text variety to expose prompt and validator issues.

## Stronger Brief Requirements

Replace generic briefs with concrete per-document instructions.

Every brief should include:

- document genre
- source or context
- output style
- facts that should appear
- facts that must not appear
- whether the document is current, stale, partial, conflicting, or noise
- realism cues such as redactions, headers, portal export style, copied text, missing fields, OCR-like line breaks, or exported system keys

Examples:

```text
Plain-text OCR-like driver license transcript copied from a DMV portal. Include labels and line breaks for name, DOB, and current residential address. Do not include SSN, phone, employer, work email, or citizenship.
```

```text
Valid JSON HRIS prehire export. Include legal name, personal email, company, title, start date, and work email. Do not include phone or work authorization identifiers.
```

```text
Stale Markdown recruiting note from an old import. Include the old email typo and explain that this is historical context only. Do not include current SSN or current full address.
```

## Checkpoint 1: Manifest Projection Tooling

Goal: make `manifest.json` regeneration an explicit no-AI operation.

Current gap:

- `manifestFromCorpusPlan()` exists inside `examples/eval/scripts/generate.mjs`
- there is no command that only projects `corpus-plan.json` to `manifest.json`
- `eval:generate` requires a model before it can reach manifest projection
- `eval:generate` refuses manifest writes when planned body files are missing

Add one explicit manifest-only path. Preferred implementation:

```bash
pnpm eval:manifest --user nina-meera-patel --corpus realistic
```

Acceptable implementation if a separate script is too much:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --manifest-only
```

Required behavior:

- no Vertex env required
- no model required
- no AI calls
- read `corpus-plan.json`
- write byte-stable `manifest.json`
- preserve the same projection as `manifestFromCorpusPlan`
- fail if `corpus-plan.json` user/corpus does not match CLI args
- optionally warn, but do not fail, when planned body files are missing

Files likely touched:

- `examples/eval/scripts/generate.mjs` or a new manifest script
- `package.json`
- `examples/eval/scripts/generate.test.mjs` or a new test file
- `examples/eval/README.md` or `PLAYBOOK.md` if command docs are updated now

Verification:

```bash
pnpm eval:test
pnpm eval:manifest --user nina-meera-patel --corpus realistic
pnpm eval:validate --user nina-meera-patel --corpus realistic
```

Acceptance:

- manifest command runs with no Vertex env
- generated manifest matches the current manifest before plan changes
- tests cover the projection path

## Checkpoint 2: Id Selection And Replacement Tooling

Goal: make preview selection and full regeneration executable before body files change.

Current gaps:

- `--limit 5` previews only the first five documents
- `--regenerate` requires full document ids
- the usage text suggests short ids such as `017`
- full generation skips existing body files

Add one shared id resolver:

- exact match: `nina-meera-patel-realistic-017`
- short sequence match: `017`
- optionally reject ambiguous short ids if future ids make ambiguity possible

Update `--regenerate` to use this resolver.

Add a preview-friendly selector:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031 --out /private/tmp/nina-preview
```

`--ids` should:

- share the same resolver as `--regenerate`
- require `--out`
- never write `manifest.json`
- not require existing body files to be missing

Add a supported full-replacement path. Preferred shape:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --overwrite --concurrency 2
```

Acceptable shape:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --regenerate all --concurrency 2
```

Do not rely on manual deletion as the normal full-regeneration workflow.

Files likely touched:

- `examples/eval/scripts/generate.mjs`
- `examples/eval/scripts/generate.test.mjs`
- command docs

Verification:

```bash
pnpm eval:test
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031 --out /private/tmp/nina-id-preview
```

Acceptance:

- short ids resolve correctly
- `--ids` requires `--out`
- `--overwrite` or `--regenerate all` selects all 100 docs even when body files already exist
- tests cover id resolution and overwrite semantics

## Checkpoint 3: Plan Extension Update

Goal: update plan metadata to the mixed file-type distribution.

Work:

- choose the exact extension for each of the 100 planned documents
- update each document path extension
- update each `outputExtension`
- keep all ids stable
- keep all titles stable unless a title no longer fits the file type
- ensure category counts still match
- do not regenerate body contents yet

Important validation behavior:

- `CORPUS_PLAN_EXTENSION_MISMATCH` only checks that each planned `path` extension matches that document's `outputExtension`
- it does not check whether body files exist
- full validation is expected to fail before body files are renamed

Verification:

```bash
pnpm eval:validate --user nina-meera-patel --corpus realistic --plan-only
pnpm eval:validate --user nina-meera-patel --corpus realistic
```

Expected full-validation failures before body files are renamed:

- missing document files for changed paths
- `MANIFEST_PLAN_MISMATCH`, because the old manifest still points at old paths

Acceptance:

- `--plan-only` passes
- full validation fails only for expected missing paths and manifest drift
- planned extension counts match the target distribution

## Checkpoint 4: Rename Existing Body Files And Regenerate Manifest

Goal: keep the deterministic local fixture valid while preparing for Vertex regeneration.

Work:

- rename existing body files to match the new planned extensions
- do not change document contents yet
- run the manifest projection command from Checkpoint 1
- refresh `validation-report.json`

This produces an intermediate working-tree state where some `.json`, `.yaml`, and `.txt` files still contain old Markdown/prose bodies. That is acceptable only as branch progress. Do not merge this intermediate state until full Vertex regeneration and body-vs-extension validation are complete.

Verification:

```bash
pnpm eval:manifest --user nina-meera-patel --corpus realistic
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:verify
```

Acceptance:

- exactly 100 body files still exist
- focused validation passes with 0 errors and 0 warnings under the current validator
- full eval verification passes

## Checkpoint 5: Stronger Per-Document Briefs

Goal: improve generation guidance without relying on one huge generic prompt.

Work:

- update all 100 `brief` strings in `corpus-plan.json`
- make every brief specific to that document
- include file-type expectations in the brief
- add explicit negative instructions for sensitive or missing facts
- keep `factKeys[]` as the authoritative allowed fact list
- keep `expectedUse`, `authority`, and `freshness` consistent with the brief

Manifest coupling:

- changing only `brief`, `challengeTags`, or `outputExtension` does not affect `manifest.json` projection except through paths and projected fields already handled earlier
- if this checkpoint touches projected fields such as `title`, `factKeys`, `detailTier`, `authority`, `freshness`, or `expectedUse`, regenerate `manifest.json`

Review samples from every category:

- identity
- address-contact
- work-authorization
- hr-onboarding
- employer-context
- partial-conflicting
- noise

Verification:

```bash
pnpm eval:validate --user nina-meera-patel --corpus realistic --plan-only
pnpm eval:validate --user nina-meera-patel --corpus realistic
```

Acceptance:

- no generic "document N" briefs remain
- every brief is file-type-aware
- validation remains green

## Checkpoint 6: Generator Prompt And Output Cleanup

Goal: make Vertex respect file types and reduce flaky structured-output failures.

Work in `examples/eval/scripts/generate.mjs`:

- add file-type-specific prompt rules
- for `md`, allow natural Markdown but discourage uniform templates
- for `txt`, request plain text only and no Markdown tables/fences
- for `json`, require valid JSON and no Markdown fences
- for `yaml`, require valid YAML and no Markdown fences
- remind the model that it may only use the provided profile slice
- remind the model not to invent intentionally missing facts
- remind the model that stale/conflicting docs must not look authoritative

Add defensive post-processing:

- strip a single wrapping Markdown code fence from `json`, `yaml`, and `txt` output
- preserve the inner content exactly apart from fence removal and final newline normalization
- do not silently repair invalid JSON/YAML beyond removing fences

Add tests in `examples/eval/scripts/generate.test.mjs`:

- prompt mentions the requested output extension
- JSON prompts prohibit Markdown fences
- TXT prompts prohibit Markdown formatting
- missing facts are included in the prompt
- only declared fact keys appear in the profile slice
- fenced JSON/YAML/TXT output is stripped before writing
- Markdown output is not stripped unless explicitly intended

Verification:

```bash
pnpm eval:test
pnpm eval:verify
```

Acceptance:

- generator tests cover prompt and output cleanup behavior
- full eval verification remains green

## Checkpoint 7: Mixed Vertex Preview

Goal: confirm the new plan and prompt produce varied, file-type-appropriate documents.

Set env in fish:

```fish
set -x GCP_PROJECT_ID (gcloud config get-value project)
set -x EVAL_GENERATION_MODEL gemini-2.5-pro
set -x VERTEX_REGION us-central1
```

Run a cross-category preview:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031,043,055,063,081 --out /private/tmp/nina-mixed-preview
```

Review:

```bash
find /private/tmp/nina-mixed-preview -type f | sort
rg -n "Nina Meera Patel|000-00-0392|nina\\.patel@example\\.test|nina\\.patel@hillcountrydata\\.example\\.test" /private/tmp/nina-mixed-preview
```

Preview acceptance:

- includes at least one `md`, `txt`, `json`, and `yaml` file
- includes at least five categories
- JSON files are parseable
- YAML files are parseable
- TXT files are not Markdown documents with a `.txt` extension
- missing values such as phone and work authorization identifiers are not invented
- noise docs do not include high-confidence current identifiers

Do not commit preview output.

## Checkpoint 8: Full Vertex Regeneration

Goal: replace deterministic bodies with Vertex-authored bodies after the mixed preview is accepted.

Before running:

- verify the mixed plan validates
- verify the preview is acceptable
- confirm the overwrite command from Checkpoint 2 is implemented
- record the model name and intended call count

Expected command:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --backend vertex --overwrite --concurrency 2
```

If the accepted implementation uses `--regenerate all`, use that command instead:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --backend vertex --regenerate all --concurrency 2
```

After generation:

```bash
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:verify
```

Acceptance:

- 100 document bodies are regenerated
- `manifest.json` is current
- `validation-report.json` is refreshed
- focused validation passes
- full eval verification passes

## Checkpoint 9: Body-Vs-Extension Validator Tightening

Goal: catch obvious file-type failures after realistic bodies exist.

Do this after full Vertex regeneration, not before.

Files likely touched:

- `examples/eval/scripts/validate.mjs`
- `examples/eval/scripts/validate.test.mjs`
- possibly `examples/eval/scripts/shared.mjs`

Add low-false-positive checks:

- JSON body must parse when `outputExtension` is `json`
- YAML body must parse when `outputExtension` is `yaml`
- JSON/YAML bodies must not contain Markdown fences
- `.txt` bodies warn on Markdown headings or tables

Severity guidance:

- JSON parse failures can be hard errors after full regeneration
- YAML parse failures can be hard errors if parser behavior is stable in tests
- Markdown-style `.txt` should start as a warning
- phone-like missing-fact checks in JSON/YAML should stay conservative because numeric ids or codes can look phone-shaped

Issue codes to consider:

- `DOCUMENT_JSON_INVALID`
- `DOCUMENT_YAML_INVALID`
- `DOCUMENT_MARKDOWN_FENCE`
- `DOCUMENT_TXT_MARKDOWN_STYLE`

Add validator tests:

- invalid JSON body fails for a planned `.json` document
- invalid YAML body fails or warns according to chosen severity
- fenced JSON/YAML is flagged
- `.txt` Markdown style warns
- committed Nina corpus passes after full regeneration

Verification:

```bash
pnpm eval:test
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:verify
```

Acceptance:

- validator tests cover each new issue code
- focused validation remains green after body regeneration
- full eval verification remains green

## Checkpoint 10: Closeout

Goal: finish the cleanup using the repo's planning workflow.

Work:

- add `initial-clean-up-1/implementation-summary.md`
- update `100-doc-goal/TODO.md`
- update `100-doc-goal/COMMANDS.MD`
- update `docs/plans/evaluation/user-generation-forms/orchestration-plan.md` if this initiative is tracked there
- record the Vertex model used
- record generation call count
- record validation status
- record any warnings reviewed
- record deferred work, especially extraction benchmarking and richer file types

Final verification:

```bash
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Risks And Rollback

Full Vertex regeneration replaces 100 committed deterministic body files with non-deterministic model-authored output.

Risks:

- generation can fail partway through and leave mixed old/new bodies
- Vertex output can be valid-looking but too uniform
- structured outputs can be invalid JSON/YAML
- missing values such as phone can be invented
- stale or conflicting docs can be written too authoritatively
- full regeneration can cost time and API quota

Rollback:

- do not merge the branch between file renaming and full regeneration
- keep preview output outside the repo
- rely on git history to restore deterministic bodies if regeneration quality is unacceptable
- if a full run fails midway, rerun with the supported overwrite path or revert generated bodies before trying again
- never use `git reset --hard` unless explicitly requested by the user

## Acceptance Criteria

This cleanup is done when:

- `corpus-plan.json` uses mixed `md`, `txt`, `json`, and `yaml`
- `manifest.json` matches the updated plan
- exactly 100 body files exist
- planned extension distribution is intentional and documented
- every document brief is specific and file-type-aware
- Vertex preview covers mixed file types and multiple categories
- generated preview files look materially more realistic than the first Markdown-only preview
- full Vertex regeneration has an explicit supported overwrite path
- body-vs-extension validator checks run after realistic bodies exist
- validation passes with 0 errors
- `pnpm eval:verify` passes
- `100-doc-goal/TODO.md` and `100-doc-goal/COMMANDS.MD` are updated
- `initial-clean-up-1/implementation-summary.md` records what happened

## Deferred Work

After this cleanup:

- add `.ics`, `.eml`, `.csv`, `.tsv`, `.vcf`, and HTML-like fixture support if still useful
- add filled-form snapshots for the Nina scenario
- design document-ingestion extraction evaluation
- decide whether to support non-Vertex generation providers
