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
  manifests, scenarios, and field maps.
- `scripts/generate-field-manifests.mjs` regenerates form field manifests.
- `scripts/generate-seed-preferences.mjs` derives generated seed preferences
  from user profiles.
- `scripts/validate.mjs` validates fixture schemas, references, field maps,
  seed determinism, and corpus coverage.
- `users/elena-marquez/` is the first normalized synthetic user fixture.
- `scenarios/elena-marquez-i9-section1/` is the first scenario-shaped fixture.

Templates, scaffold generation, and an eval runner are planned for later
batches.

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

Corpus manifests live at:

```text
users/<userId>/corpora/<corpusId>/manifest.json
```

Scenario fixtures live at:

```text
scenarios/<scenarioId>/scenario.json
scenarios/<scenarioId>/start/prompt.md
```

Form field maps live beside forms:

```text
forms/<formId>/field-map.json
```

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

Useful focused validation commands:

```bash
pnpm eval:validate --user elena-marquez --corpus realistic
pnpm eval:validate --scenario elena-marquez-i9-section1
pnpm eval:validate --form i-9
```

Write the deterministic corpus report:

```bash
pnpm eval:validate --user elena-marquez --corpus realistic --write-report
```

Validator exit codes are `0` for pass, `1` for validation failures, and `2`
for unsupported CLI usage.

## Manual Smoke Check

Until the eval runner exists, the I-9 fixture can be checked manually:

1. Seed memory from `users/elena-marquez/seed-preferences.generated.json`.
2. Analyze or import files from
   `users/elena-marquez/corpora/realistic/documents/`.
3. Use `scenarios/elena-marquez-i9-section1/start/prompt.md` as the scenario
   prompt context.
4. Open `/dashboard/form-fill`.
5. Upload `forms/i-9/form.pdf`.
6. Compare filled and skipped fields against `forms/i-9/field-map.json`.
