# Eval Fixtures

This directory is the canonical home for local evaluation fixtures.

All fixture data is synthetic. These files support local scripts and evaluation
workflows only; they are not backend product behavior.

For contributor workflows and snapshot review guidance, see
[`PLAYBOOK.md`](PLAYBOOK.md).

## Current Contents

- `forms/` contains fillable PDF fixtures, generated field manifests, generated
  fake-user requirement notes, and hand-authored field maps for
  evaluation-ready forms.
- `forms-notes.md` records human context about what each form asks for.
- `schemas/` contains the local fixture contracts for profiles, corpus
  manifests, scenarios, field maps, template metadata, and filled-form
  snapshots.
- `scripts/generate-field-manifests.mjs` regenerates form field manifests.
- `scripts/generate-seed-preferences.mjs` derives generated seed preferences
  from user profiles.
- `scripts/scaffold.mjs` renders deterministic template corpora and optional
  first-time scenario skeletons.
- `scripts/plan-corpus.mjs` creates deterministic starter corpus manifests for
  reviewed user profiles.
- `scripts/generate.mjs` generates AI-authored realistic corpus document bodies
  from a reviewed V2 `manifest.json`.
- `scripts/repair-generation.mjs` repairs failed preview documents using
  validation feedback.
- `scripts/promote-preview.mjs` promotes a passing preview into the committed
  corpus.
- `scripts/validate.mjs` validates fixture schemas, references, field maps,
  seed determinism, and corpus coverage.
- `scripts/run.mjs` runs local deterministic backend form-fill eval scenarios
  and compares or updates expected snapshots.
- `scripts/fill-form.mjs` fills a scenario form through the live backend
  product endpoint using the authenticated user's current active preferences and
  writes a scorable `filled-form.json` artifact.
- `templates/` contains trusted repo-local `.mjs` document archetypes for
  deterministic fixture generation.
- `users/alex-i9-test/` is a realistic generated I-9 corpus fixture used for
  live ingestion and backend-memory form-fill evaluation.
- `users/elena-marquez/` is the first normalized synthetic user fixture.
- `users/samir-desai/` is the second I-9 fixture user, with a lawful permanent
  resident work-authorization profile.
- `scenarios/alex-i9-realistic/` is a live backend-memory I-9 scenario that
  writes output to explicit artifact paths instead of committed golden
  snapshots.
- `scenarios/elena-marquez-i9-template-smoke/` is the first runner-owned
  scenario with an expected `filled-form` snapshot.
- `scenarios/samir-desai-i9-template-smoke/` is a second runner-owned I-9
  scenario that exercises non-null USCIS/A-number fields.

## Contract Shape

User facts live in `users/<userId>/profile.yaml`. Fact keys are local fixture
paths such as `identity.legalName` and `address.current.postalCode`.

MCP preference slugs are separate backend memory identifiers such as
`profile.full_name`. The only current bridge between local fact keys and MCP
slugs is `profile.yaml` `seedPreferences[]`, which is projected into
`users/<userId>/seed-preferences.generated.json`.

Seed projection is strict: `seedPreferences[]` supports one `slug` and one
`factKey` per entry, with no joining or coercion. Null facts are omitted from
generated seed preferences; empty arrays are emitted because they are explicit
data. Form-fill rendering is separate runner behavior and may render array
facts as scalar field values when a PDF field is scalar.

Corpus manifests use `schemaVersion: 2`. `corpusKind` identifies the corpus
shape:

- `template-smoke` for deterministic template-rendered corpora.
- `realistic-generated` for AI-authored source-artifact corpora.

Corpus manifest `documents[].factContract.include` entries must be concrete
profile fact leaves. Area markers such as `address.current` are intentionally
invalid. Per-document forbidden facts live in
`documents[].factContract.forbid`, and realistic corpora can also define
top-level `factContractDefaults.forbid`.

Document role metadata lives in `documents[].evaluationRole`. `detailTier`
describes richness only: `hero`, `medium`, or `brief`. Noise semantics live in
`category` and `evaluationRole.expectedUse`.

Corpus manifests include a required deterministic `seed`. Template-scaffolded
documents include `documents[].template`; realistic generated documents include
`documents[].sourceSpec` and omit `template`. Document count is derived from
`documents.length`.

Corpus manifests live at:

```text
users/<userId>/corpora/<corpusId>/manifest.json
```

Scenario fixtures live at:

```text
scenarios/<scenarioId>/scenario.json
scenarios/<scenarioId>/start/prompt.md
scenarios/<scenarioId>/expected/*.json
```

Scaffold may create a scenario skeleton the first time, but it refuses to
overwrite an existing scenario even with `--force`. Once a scenario has expected
snapshots, update it through `pnpm eval:run --update-snapshots`, not scaffold.

Form field maps live beside forms:

```text
forms/<formId>/field-map.json
```

Fact field maps may include an explicit `render` hint when the PDF field
requires a representation different from the raw profile value. The current
renderer supports `digits-only` for fields such as a fixed-width SSN box.

Template modules live at:

```text
templates/<category>/<templateSlug>.mjs
```

Each template exports `meta` and `render(helpers)`. The template id must match
the path without `.mjs`, for example
`templates/identity/name-history-note.mjs` uses
`identity/name-history-note`.

## Commands

Command distinction:

- `pnpm eval:test` runs script tests.
- `pnpm eval:validate` validates committed fixture integrity.
- `pnpm eval:verify` runs both and is the local non-DB gate.

Regenerate form field manifests after adding or replacing PDFs:

```bash
pnpm eval:manifests
```

Regenerate seed preferences from profiles:

```bash
pnpm eval:derive-seeds
```

Validate all local eval fixtures:

```bash
pnpm eval:validate
```

Validate a planned corpus before document bodies exist:

```bash
pnpm eval:validate --user samir-desai --corpus realistic --plan-only
```

Run eval fixture tests:

```bash
pnpm eval:test
```

Run the local non-DB gate:

```bash
pnpm eval:verify
```

Run the deterministic local eval runner:

```bash
pnpm eval:run --scenario elena-marquez-i9-template-smoke
pnpm eval:run --scenario samir-desai-i9-template-smoke
```

Show runner-internal stacks for unexpected failures:

```bash
pnpm eval:run --scenario elena-marquez-i9-template-smoke --verbose
```

Update expected snapshots deliberately:

```bash
pnpm eval:run --scenario elena-marquez-i9-template-smoke --update-snapshots
```

Run the live backend-memory form-fill runner after preparing backend memory:

```bash
export EVAL_BACKEND_URL=http://localhost:3000
export EVAL_AUTH_TOKEN=<token>

pnpm eval:fill-form \
  --scenario alex-i9-realistic \
  --out /private/tmp/alex-filled-form.json \
  --filled-pdf-out /private/tmp/alex-filled.pdf \
  --response-out /private/tmp/alex-form-fill-response.json \
  --form-score-report /private/tmp/alex-form-score-report.json
```

`eval:run` is the deterministic fixture/test-DB harness. `eval:fill-form` is
the live backend-memory product-path runner and does not seed, reset, hydrate,
or mutate memory.

Useful focused validation commands:

```bash
pnpm eval:validate --user elena-marquez --corpus template-smoke
pnpm eval:validate --user samir-desai --corpus template-smoke
pnpm eval:validate --scenario elena-marquez-i9-template-smoke
pnpm eval:validate --scenario samir-desai-i9-template-smoke
pnpm eval:validate --form i-9
```

Write the deterministic corpus report:

```bash
pnpm eval:validate --user elena-marquez --corpus template-smoke --write-report
```

Regenerate committed `validation-report.json` files when corpus manifests or
document bodies change.

Render or refresh a deterministic template corpus:

```bash
pnpm eval:scaffold --user elena-marquez --corpus template-smoke --form i-9 --force
```

Plan a 10-document realistic starter corpus from a reviewed profile:

```bash
pnpm eval:plan-corpus --user <userId> --corpus realistic --form i-9 --count 10
```

Validate the manifest before document bodies exist:

```bash
pnpm eval:validate --user <userId> --corpus realistic --plan-only
```

Generate realistic corpus documents from a reviewed manifest into a preview:

```bash
EVAL_GENERATION_MODEL=gemini-2.5-pro \
  pnpm eval:generate --user <userId> --corpus realistic --backend vertex --out /private/tmp/<userId>-realistic-preview
```

Repair only failed preview documents:

```bash
EVAL_GENERATION_MODEL=gemini-2.5-pro \
  pnpm eval:repair-generation --user <userId> --corpus realistic --from /private/tmp/<userId>-realistic-preview --backend vertex --max-attempts 3
```

Promote a passing preview into the committed corpus:

```bash
pnpm eval:promote-preview --user <userId> --corpus realistic --from /private/tmp/<userId>-realistic-preview
```

Initialize a new user profile skeleton from a form field map:

```bash
pnpm eval:scaffold --init-user --user nina-patel --display-name "Nina Patel" --form i-9
```

Validator exit codes are `0` for pass, `1` for validation failures, and `2`
for unsupported CLI usage.

## Automated Smoke Check

The I-9 template-smoke scenario exercises the backend form-fill API through the
test-app harness. It validates fixture integrity, hydrates active preferences
from `profile.yaml`, injects deterministic AI fill actions, posts
`forms/i-9/form.pdf` to `/api/form-fill/pdf`, and compares
`expected/filled-form.json`. Elena's scenario covers a U.S. citizen profile;
Samir's covers a lawful permanent resident profile with non-null USCIS/A-number
fields.

The backend test database must be running and migrated:

```bash
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm eval:run --scenario elena-marquez-i9-template-smoke
pnpm eval:run --scenario samir-desai-i9-template-smoke
```
