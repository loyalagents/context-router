# Eval Fixture Playbook

This playbook describes how to change the local eval fixtures without turning
them into backend product behavior.

The normal pipeline is:

```text
profile.yaml -> pnpm eval:derive-seeds -> pnpm eval:scaffold -> pnpm eval:validate -> pnpm eval:run -> expected snapshots
```

Use `pnpm eval:verify` as the local non-DB gate before opening a PR. It runs
the eval script tests and full fixture validation.

## Ownership Rules

- `users/<userId>/profile.yaml` is the source of truth for user facts.
- `seed-preferences.generated.json` is generated from `profile.yaml`; do not
  hand-edit it.
- `forms/<formId>/fields.generated.json` is generated from the PDF; do not
  hand-edit it.
- `users/<userId>/corpora/<corpusId>/validation-report.json` is validator
  output; regenerate it with `--write-report`.
- `field-map.json` is hand-authored and form-scoped. Keep user-specific absence
  in profile nulls and corpus `intentionallyMissing[]` entries when possible.
- Scaffold owns generated corpora and first-time scenario skeletons.
- Once a scenario exists, runner-owned snapshots under `expected/` change only
  through `pnpm eval:run --scenario <scenarioId> --update-snapshots`.

## Adding A User

Create a profile skeleton from an existing field map:

```bash
pnpm eval:scaffold --init-user --user <userId> --display-name "<Name>" --form i-9
```

Fill in `users/<userId>/profile.yaml`. Keep facts in `facts:` and keep
`seedPreferences[]` as the explicit bridge from local fact keys to backend
preference slugs.

Then regenerate seeds and validate:

```bash
pnpm eval:derive-seeds
pnpm eval:validate --user <userId>
```

Null facts are meaningful. Use them for intentionally absent values that the
runner should skip instead of guessing.

## Adding Or Refreshing A Corpus

Use scaffold for generated template corpora:

```bash
pnpm eval:scaffold --user <userId> --corpus <corpusId> --form i-9
```

Use `--missing <factKey>` for selected-form facts that are intentionally null
and should be recorded in `manifest.json`. Use `--force` only when deliberately
refreshing a generated corpus.

Scaffold may create a scenario skeleton the first time:

```bash
pnpm eval:scaffold --user <userId> --corpus <corpusId> --form i-9 --scenario <scenarioId>
```

It will not overwrite an existing scenario, even with `--force`.

## Adding A 100-Doc Realistic Corpus

For large realistic corpora, author `corpus-plan.json` first. Treat it as the
source of truth for per-document ids, paths, categories, fact keys, challenge
tags, and briefs. `manifest.json` is generated from that plan and should not be
hand-edited.

Before bodies exist, validate the plan only:

```bash
pnpm eval:validate --user <userId> --corpus realistic --plan-only
```

Preview a few AI-generated documents outside the committed corpus:

```bash
EVAL_GENERATION_MODEL=<model> \
  pnpm eval:generate --user <userId> --corpus realistic --backend vertex --ids 001,017,031 --out /private/tmp/<userId>-preview
```

Review the preview for realism, fact accuracy, noise behavior, and stale or
conflicting cues before generating the committed corpus. For committed
generation, use an explicit `EVAL_GENERATION_MODEL`; do not rely on backend
product defaults.

Then generate the corpus and validate:

```bash
EVAL_GENERATION_MODEL=<model> \
  pnpm eval:generate --user <userId> --corpus realistic --backend vertex --overwrite

pnpm eval:validate --user <userId> --corpus realistic --write-report
```

Treat `corpus-plan.json` metadata as the intended corpus-truth contract. For
`extract` and `corroborate` documents, validation hard-fails when declared
deterministic facts such as names, current address parts, DOB, ZIP, state,
citizenship status, employer/title, or employment start date are missing from
the body. If validation reports one of these errors, decide explicitly whether
the metadata overclaimed or the generated body drifted; for generated 100-doc
corpora, the default repair is to make the body match the plan.
`defaultForbiddenFactKeys[]` and per-document `forbiddenFactKeys[]` checks only
run when a corpus plan is present, and forbidden values stay plan-owned rather
than being copied into `manifest.json`.

Before using a corpus for extraction benchmarking, inspect
`validation-report.json` -> `corpusTruth`. It records, per document, which
declared facts were proven present, which declared facts are still unsupported
by deterministic checks, and which effective forbidden facts were proven
absent, warning-only, or skipped. Treat a passing report with zero hard
failures as the corpus-truth readiness gate for the current deterministic
layer, not as a backend extraction-quality score.

If only plan metadata changed, regenerate the manifest without any AI calls:

```bash
pnpm eval:manifest --user <userId> --corpus realistic
```

The generated documents are fixture artifacts. They become an extraction
benchmark only after a later ingestion runner analyzes the documents and
compares extracted facts to expected snapshots.

## Adding Or Editing Templates

Templates live at:

```text
templates/<category>/<slug>.mjs
```

Each template exports `meta` and `render(helpers)`. The `meta.templateId` must
match the path without `.mjs`, for example
`identity/name-history-note`.

Keep templates deterministic:

- Declare every accessed fact in `requiredFactKeys` or `optionalFactKeys`.
- Use concrete leaf fact keys only; area keys such as `address.current` are
  invalid.
- Use `fact()`, `maybeFact()`, `joinFact()`, and `dateFact()` helpers instead
  of reading profile data directly.
- Use `choose(key, values)` for variation so output is stable for the same
  seed.
- Keep one document archetype per template. Do not hide multiple document types
  or file formats behind one large switch.

Run:

```bash
pnpm eval:test
pnpm eval:validate
```

The renderer tests and validator enforce declared fact access, deterministic
rerenders, template metadata, and manifest template references. Templates may
be profile-specific, but each committed template must render against at least
one committed profile with matching non-null required facts.

## Adding A Field Map

Field maps live beside the form:

```text
forms/<formId>/field-map.json
```

Regenerate generated fields after adding or replacing a PDF:

```bash
pnpm eval:manifests
```

Then author one field-map entry for each generated field. Use `mode: "fact"`
for fields backed by `profile.yaml` facts and `mode: "skip"` for out-of-scope,
manual-attestation, or unmapped fields.

Use `render` hints when a PDF field needs a representation different from the
raw profile value. V1 supports `digits-only`, used by the I-9 SSN field.

Run focused checks:

```bash
pnpm eval:validate --form <formId>
pnpm eval:validate
```

## Adding A Scenario

A scenario combines one user, one corpus, one form, a prompt, and expected
snapshots:

```text
scenarios/<scenarioId>/scenario.json
scenarios/<scenarioId>/start/prompt.md
scenarios/<scenarioId>/expected/filled-form.json
```

Scaffold can create the first skeleton. After that, edit the scenario by hand
and let the runner own expected snapshots.

For a runner-owned scenario with `expectedSnapshots: ["filled-form"]`, create or
refresh the snapshot only through:

```bash
pnpm eval:run --scenario <scenarioId> --update-snapshots
```

Then immediately compare in normal mode:

```bash
pnpm eval:run --scenario <scenarioId>
```

## Snapshot Review

Review `expected/filled-form.json` before accepting an update.

Start with:

- `summary.totalFields`
- `summary.filledCount`
- `summary.skippedCount`
- `summary.plannedActionCounts`
- `summary.warnings`

Then inspect changed `fields[]` entries by `fieldIndex`, `pdfFieldName`,
`fieldMap`, `expected`, `actual`, and `classification`.

Classification guidance:

- `correct`: expected action and decoded PDF value agree.
- `skipped-correctly`: acceptable only when the skip reason matches field-map
  intent or a null profile fact.
- `missing`: likely a regression unless the field intentionally stopped being
  filled.
- `incorrect`: likely a regression in rendering, field mapping, or backend
  filling.
- `hallucinated`: a skipped field was filled; treat as high-risk.
- `unsupported`: runner capability gap, not successful form-fill behavior.

Use `--update-snapshots` only after deciding the new output is the desired
deterministic contract.

## Report-Driven Repair

For corpus repair, start with validation:

```bash
pnpm eval:validate --user <userId> --corpus <corpusId> --write-report
```

Read `validation-report.json`, then patch only the listed source of the issue:

- `profile.yaml` for missing, null, or mistyped facts.
- template modules for bad metadata, undeclared facts, or nondeterministic
  rendering.
- corpus `manifest.json` for document inventory, fact coverage, or
  intentionally missing metadata.
- document files when a listed manifest path is missing.
- `field-map.json` for field coverage, wrong names, or bad fact references.

Rerun the focused validation command after each repair. Avoid broad rewrites
that are not tied to report issues.

## Optional DB Smoke

The no-DB gate is:

```bash
pnpm eval:verify
```

The DB-backed smoke path exercises the backend test-app harness and requires
the backend test database. See the "Automated Smoke Check" section in
`README.md` for the command sequence.

## V1 Limitations

- Runner hydration is deterministic and service-based. It reads `profile.yaml`
  and generated seed preferences, then writes active preferences directly for
  the local backend harness.
- Corpus documents are validated for coverage but are not ingested through the
  document-analysis path.
- `eval:test`, `eval:validate`, `eval:verify`, and `eval:run` do not make real
  LLM calls. `eval:generate` is the local maintainer command that calls Vertex
  AI to draft realistic committed fixture documents.
- No UI or browser automation.
- Only `filled-form` snapshots exist today.
- Only I-9 has a field map today.
- I-9 citizenship and alternative-procedure checkboxes are a named future
  hardening task because current generated field metadata does not expose
  reliable labels.

Current repeatability coverage uses two I-9 users against the same form map:
Elena Marquez as a U.S. citizen profile and Samir Desai as a lawful permanent
resident profile with non-null USCIS/A-number fields.
