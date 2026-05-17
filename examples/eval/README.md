# Eval Fixtures

This directory is the canonical home for local evaluation fixtures.

## Current Contents

- `forms/` contains fillable PDF fixtures, generated field manifests, and generated fake-user requirement notes.
- `forms-notes.md` records human notes about the information each form asks for.
- `scripts/generate-field-manifests.mjs` regenerates the form field manifests.
- `users/elena-marquez/` is the first migrated synthetic user fixture.

Elena is migrated as-is from the legacy form-fill demo shape. Her `simple/` seed
data and `realistic/manifest.json` are not the final eval contract yet. The
schema contract batch will normalize her into the canonical profile, manifest,
scenario, and mapping shapes.

This cleanup batch does not add schemas, a validator, templates, scaffold
generation, scenarios, or an eval runner.

## Commands

Regenerate form field manifests after adding or replacing PDFs:

```bash
pnpm eval:manifests
```

There is no `eval:validate` command yet. Fixture validation is planned for the
validator batch.

## Manual Smoke Check

Until the eval runner exists, the I-9 fixture can still be checked manually:

1. Seed memory from `users/elena-marquez/simple/seed-preferences.json`.
2. Analyze or import files from `users/elena-marquez/realistic/documents/`.
3. Open `/dashboard/form-fill`.
4. Upload `forms/i-9/form.pdf`.
5. Compare the filled and skipped fields against `forms-notes.md` and Elena's README.

All fixture data is synthetic and non-sensitive.
