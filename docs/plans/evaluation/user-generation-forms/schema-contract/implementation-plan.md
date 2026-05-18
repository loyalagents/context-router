# Batch 1 Implementation Plan: Schema Contract

## Summary

Define the local eval fixture contracts under `examples/eval/`, normalize Elena
into those contracts, and leave validation, scaffold generation, templates, and
the scenario runner for later batches.

This batch intentionally breaks legacy Elena paths and shapes when doing so
makes the future contract simpler.

## Contract Decisions

- Use `users/<userId>/corpora/<corpusId>/`. Move Elena from
  `users/elena-marquez/realistic/` to
  `users/elena-marquez/corpora/realistic/`.
- Keep stable user-level files:
  - `users/<userId>/profile.yaml`
  - `users/<userId>/seed-preferences.generated.json`
- Add schemas under `examples/eval/schemas/`:
  - `profile.schema.json`
  - `manifest.schema.json`
  - `scenario.schema.json`
  - `field-map.schema.json`
- All schemas start fresh at `schemaVersion: 1`; Elena's legacy
  `schemaVersion: 2` is retired, not migrated forward.
- Do not add `fields.schema.json`; `generate-field-manifests.mjs` owns
  `fields.generated.json`.
- Add root dependency `yaml@^2.8.1` and root script `eval:derive-seeds`.

## Profile And Seeds

- `profile.yaml` is the authoritative user fact source. Shape:
  `schemaVersion`, `userId`, `displayName`, `facts`, `seedPreferences`.
- Fact keys are local fixture keys, not MCP slugs. Use dot-delimited
  lowerCamelCase paths: `identity.legalName`,
  `address.current.postalCode`, `workAuthorization.citizenshipStatus`.
- Use `identity.ssn`, not `identity.syntheticSsn`; docs should state all
  fixture SSNs are synthetic.
- Dates use ISO `YYYY-MM-DD`.
- Denormalized facts are allowed when they are canonical form-fill values.
  Elena should include both `identity.legalName` and name parts.
- Purposefully absent facts are declared in `profile.yaml` with `null`.
  Elena should include `contact.phone: null`.
- `seedPreferences[]` supports only `{ slug, factKey }`. No joins, coercion,
  wrapping, or splitting.
- Array MCP slugs project from array facts.
- `seed-preferences.generated.json` is committed generated output: sorted by
  `slug`, 2-space JSON, trailing newline.
- Seed derivation omits null-valued facts. Batch 2 validates slug existence and
  type compatibility.

## Manifest Contract

- Manifest shape: `schemaVersion`, `userId`, `corpusId`, `forms`, `purpose`,
  `distribution`, `intentionallyMissing`, `documents`.
- `forms` is required; Elena uses `["i-9"]`.
- `distribution` is required but minimal in V1:
  `{ "documentCount": 100 }`.
- V1 manifest does not include `seed`; Batch 3 can add generation seed
  semantics.
- `intentionallyMissing` is canonical for deliberate omissions:
  - `factKey`
  - `forms`
  - `reason`
  - `expectedBehavior`
- Field maps still map intentionally missing fields to facts. They do not carry
  missingness.
- Per-document shape: `id`, `path`, `category`, `title`, `factKeys`,
  `detailTier`, `authority`, `freshness`, `expectedUse`, `template: null`,
  optional `note`.
- Drop legacy manifest fields: `generatedDocumentCount`, `formId`,
  `fillPolicy`, `canonicalFactsForReview`, `factHints`,
  `containsI9UsefulInfo`, `containsTelephoneValue`, `relatedForms`.

Legacy hint rewrite table:

| Legacy hint | New handling |
| --- | --- |
| `full_name` | `identity.legalName` |
| `first_name` | `identity.firstName` |
| `last_name` | `identity.lastName` |
| `middle_initial` | `identity.middleInitial` |
| `other_last_names` | `identity.otherLastNames` |
| `date_of_birth` | `identity.dateOfBirth` |
| `ssn` | `identity.ssn` |
| `email` | `contact.email` |
| `address`, `city`, `state`, `zip` | `address.current` |
| `citizenship` | `workAuthorization.citizenshipStatus` |
| `company` | `employment.company` |
| `title` | `employment.title` |
| `start_date` | `employment.startDate` |
| `work_email` | `employment.workEmail` |
| `list_b`, `list_c` | no `factKeys`; preserve as `note` if useful |
| `section_policy`, `skip_*`, `employer_*`, `old_*`, `*_noise` | no `factKeys`; preserve as `note` only when useful |

## Field Map And Scenario Contract

- Field maps live beside forms as `forms/<formId>/field-map.json`.
- A field map is required only for scenario-targeted/evaluation-ready forms.
  When present, it must be exhaustive for that form's `fields.generated.json`.
- Field map shape: `schemaVersion`, `formId`, `fields`.
- Each field entry includes `fieldIndex`, exact `pdfFieldName`, `mode`,
  optional `note`.
- `mode: "fact"` requires `factKey`.
- `mode: "skip"` requires `reason`: `manual_attestation`, `out_of_scope`,
  `not_applicable`, or `unmapped`.
- Use `out_of_scope` for fields outside the scenario role or intent, such as
  I-9 employer Section 2 in an employee-memory scenario.
- Use `not_applicable` for fields inside the scenario intent that do not apply
  to the user, such as USCIS/A-number for a U.S. citizen.
- I-9 `unmapped.needs_review` fields use `mode: "skip", reason: "unmapped"`
  with a note.
- `contact.phone` maps as `mode: "fact"`; Elena's profile declares it as
  `null`, and the corpus manifest marks it intentionally missing.
- Scenario fixtures live at `examples/eval/scenarios/<scenarioId>/`.
- `scenario.json` shape: `schemaVersion`, `scenarioId`, `userId`,
  `corpusId`, `formId`, optional `description`, optional
  `expectedSnapshots`.
- `expectedSnapshots` is a string array using conventional stems:
  `filled-form`, `written-preferences`, `final-preferences`.
- Use only `start/prompt.md`; delete the old `simple/local-memory.md` split.

## Documentation Changes

- Update `examples/eval/README.md`:
  - document the new contract files and directories
  - explain profile fact keys vs MCP preference slugs
  - replace the smoke check with new paths:
    - `users/elena-marquez/seed-preferences.generated.json`
    - `users/elena-marquez/corpora/realistic/documents/`
    - `scenarios/elena-marquez-i9-section1/`
  - state there is still no `eval:validate`, scaffold, templates, or runner
- Update `examples/eval/users/elena-marquez/README.md`:
  - point to `profile.yaml`, generated seeds, the realistic corpus, and the
    I-9 scenario
  - explain intentional phone omission
  - state all identity values are synthetic
- Delete `users/elena-marquez/corpora/realistic/README.md` unless it has
  unique information; fold useful guidance into the user README, manifest
  notes, or scenario prompt.
- Keep `examples/eval/forms-notes.md` as human form context for now. Add a
  short note that machine mapping lives in `forms/<formId>/field-map.json`.
- Write
  `docs/plans/evaluation/user-generation-forms/schema-contract/implementation-summary.md`.
- Update Batch 1 status and current-state bullets in `orchestration-plan.md`.

## Checkpoints

1. Contract checkpoint:
   - Add schema files.
   - Update eval README contract docs.
   - Verify schema JSON parses.

2. Seed checkpoint:
   - Add Elena `profile.yaml`.
   - Add `generate-seed-preferences.mjs`.
   - Add `yaml` dependency and `pnpm eval:derive-seeds`.
   - Generate committed `seed-preferences.generated.json`.
   - Verify rerun determinism.

3. Corpus checkpoint:
   - Move Elena to `corpora/realistic/`.
   - Rewrite manifest to V1.
   - Delete `simple/`.
   - Delete or fold the corpus README.

4. Field-map and scenario checkpoint:
   - Add exhaustive `forms/i-9/field-map.json`.
   - Add `scenarios/elena-marquez-i9-section1/scenario.json` and
     `start/prompt.md`.
   - Do not add expected snapshots.

5. Closure checkpoint:
   - Complete docs updates.
   - Write implementation summary.
   - Mark Batch 1 complete in orchestration plan.

## Verification

Run:

```bash
pnpm eval:manifests
pnpm eval:derive-seeds  # generate
pnpm eval:derive-seeds  # deterministic rerun
git diff -- examples/eval/users/elena-marquez/seed-preferences.generated.json
```

Run a one-off Node check that:

- parses schemas, profile YAML, manifest, field map, and scenario
- verifies manifest document paths exist
- verifies I-9 field-map length equals I-9 field count
- verifies every referenced `factKey` exists in `profile.yaml`, allowing null
  values

Run stale-reference checks:

```bash
rg "simple/seed-preferences.json|containsI9UsefulInfo|containsTelephoneValue|factHints|canonicalFactsForReview" examples/eval
rg "examples/eval/users/elena-marquez/(simple|realistic)" apps/backend apps/web examples/eval
rg "elena-marquez" apps/backend apps/web
```

Expected: no stale matches.

## Assumptions

- All V1 corpora under `examples/eval/users/<userId>/corpora/<corpusId>/` are
  committed source artifacts.
- Batch 1 can use one-off verification commands; Batch 2 promotes checks into
  `eval:validate`.
- Breaking old Elena fixture paths and shapes is intentional.
