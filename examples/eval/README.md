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
- `users/elena-marquez/` is the first normalized synthetic user fixture.
- `scenarios/elena-marquez-i9-section1/` is the first scenario-shaped fixture.

There is no `eval:validate` command yet. Fixture validation, templates, scaffold
generation, and an eval runner are planned for later batches.

## Contract Shape

User facts live in `users/<userId>/profile.yaml`. Fact keys are local fixture
paths such as `identity.legalName` and `address.current.postalCode`.

MCP preference slugs are separate backend memory identifiers such as
`profile.full_name`. The only current bridge between local fact keys and MCP
slugs is `profile.yaml` `seedPreferences[]`, which is projected into
`users/<userId>/seed-preferences.generated.json`.

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
