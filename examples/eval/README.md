# Eval Fixtures

This directory is the canonical home for local evaluation fixtures.

All fixture data is synthetic. These files support local scripts and evaluation
workflows only; they are not backend product behavior.

## Current Contents

- `forms/` contains fillable PDF fixtures, generated field manifests, generated
  fake-user requirement notes, and hand-authored field maps for
  evaluation-ready forms.
- `forms-notes.md` records human context about what each form asks for.
- `schemas/` contains the V1 local fixture contracts for profiles, corpus
  manifests, scenarios, field maps, template metadata, and filled-form
  snapshots.
- `scripts/generate-field-manifests.mjs` regenerates form field manifests.
- `scripts/generate-seed-preferences.mjs` derives generated seed preferences
  from user profiles.
- `scripts/scaffold.mjs` renders deterministic template corpora and optional
  first-time scenario skeletons.
- `scripts/validate.mjs` validates fixture schemas, references, field maps,
  seed determinism, and corpus coverage.
- `scripts/run.mjs` runs local deterministic backend form-fill eval scenarios
  and compares or updates expected snapshots.
- `templates/` contains trusted repo-local `.mjs` document archetypes for
  deterministic fixture generation.
- `users/elena-marquez/` is the first normalized synthetic user fixture.
- `scenarios/elena-marquez-i9-section1/` is the first scenario-shaped fixture.
- `scenarios/elena-marquez-i9-template-smoke/` is the first runner-owned
  scenario with an expected `filled-form` snapshot.

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

Corpus manifest `documents[].factKeys` entries must be concrete profile fact
leaves. Area markers such as `address.current` are intentionally invalid.
`detailTier` describes richness only: `hero`, `medium`, or `brief`. Noise
semantics live in `category` and `expectedUse`.

Corpus manifests include a required deterministic `seed`. Hand-authored
documents omit `documents[].template`; scaffold-generated documents include the
template id used to render the file. Document count is derived from
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

Template modules live at:

```text
templates/<category>/<templateSlug>.mjs
```

Each template exports `meta` and `render(helpers)`. The template id must match
the path without `.mjs`, for example
`templates/identity/name-history-note.mjs` uses
`identity/name-history-note`.

## Commands

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

Run eval fixture tests:

```bash
pnpm eval:test
```

Run the deterministic local eval runner:

```bash
pnpm eval:run --scenario elena-marquez-i9-template-smoke
```

Update expected snapshots deliberately:

```bash
pnpm eval:run --scenario elena-marquez-i9-template-smoke --update-snapshots
```

Useful focused validation commands:

```bash
pnpm eval:validate --user elena-marquez --corpus realistic
pnpm eval:validate --user elena-marquez --corpus template-smoke
pnpm eval:validate --scenario elena-marquez-i9-section1
pnpm eval:validate --scenario elena-marquez-i9-template-smoke
pnpm eval:validate --form i-9
```

Write the deterministic corpus report:

```bash
pnpm eval:validate --user elena-marquez --corpus realistic --write-report
```

Render or refresh a deterministic template corpus:

```bash
pnpm eval:scaffold --user elena-marquez --corpus template-smoke --form i-9 --force
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
`expected/filled-form.json`.

The backend test database must be running and migrated:

```bash
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm eval:run --scenario elena-marquez-i9-template-smoke
```
