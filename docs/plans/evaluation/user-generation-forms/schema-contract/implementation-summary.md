# Schema Contract Implementation Summary

- Status: complete
- Date: 2026-05-18

## What Changed

- Added V1 local eval schemas under `examples/eval/schemas/` for profiles,
  corpus manifests, scenarios, and form field maps.
- Added `examples/eval/users/elena-marquez/profile.yaml` as Elena's
  authoritative fact source.
- Added `examples/eval/scripts/generate-seed-preferences.mjs` and root script
  `pnpm eval:derive-seeds`.
- Added root dependency `yaml@^2.8.1` for profile parsing.
- Generated committed Elena seed preferences at
  `examples/eval/users/elena-marquez/seed-preferences.generated.json`.
- Moved Elena's realistic corpus to
  `examples/eval/users/elena-marquez/corpora/realistic/`.
- Rewrote Elena's corpus manifest to the V1 inventory contract, including
  `corpusId`, `forms`, minimal `distribution`, per-document `factKeys`, and
  `intentionallyMissing` for `contact.phone`.
- Added an exhaustive I-9 field map at `examples/eval/forms/i-9/field-map.json`.
- Added the first scenario fixture at
  `examples/eval/scenarios/elena-marquez-i9-section1/`.

## Contract Decisions Captured

- `profile.yaml` is the source of truth for user facts; null values declare
  purposefully absent facts.
- Local fact keys use dot-delimited lowerCamelCase and are separate from MCP
  preference slugs.
- `seed-preferences.generated.json` is a deterministic projection from
  `profile.yaml` `seedPreferences[]`; null facts are omitted.
- Field maps map form fields to facts or skip reasons. Intentional missingness
  lives in the corpus manifest, not in field maps.
- The I-9 field map stays form-scoped. User-specific inapplicability is
  represented by null facts in `profile.yaml`, including Elena's non-applicable
  work-authorization identifiers.
- `identity.ssn` is the canonical fact key; fixture docs explain the value is
  synthetic.
- Scenario fixtures use `scenario.json` plus `start/prompt.md`; the old
  `simple/local-memory.md` split was removed.

## Deleted Or Retired

- Removed Elena's old `simple/` directory.
- Removed the old `users/elena-marquez/realistic/` path.
- Removed the corpus-level README after folding durable guidance into the
  user README, manifest notes, and scenario prompt.
- Retired legacy manifest fields such as `canonicalFactsForReview`,
  `factHints`, `containsI9UsefulInfo`, and `containsTelephoneValue`.

## Documentation Updates

- Updated `examples/eval/README.md` with the new contract directories, seed
  derivation command, and current manual smoke-check paths.
- Updated `examples/eval/users/elena-marquez/README.md` to point at
  `profile.yaml`, generated seeds, the realistic corpus, and the scenario.
- Updated `examples/eval/forms-notes.md` to note that machine-readable form
  mapping lives in `forms/<formId>/field-map.json`.
- Marked Batch 1 complete in `orchestration-plan.md`.

## Verification

Ran:

```bash
pnpm eval:manifests
```

Result:

- `2026-27-fafsa-form`: 463 fields
- `fw4`: 48 fields
- `i-9`: 48 fields
- `rental-app-fillable`: expected extraction failure retained
- `saws-1-snap`: 115 fields
- `sf86-16a-nat-security-questionare`: 6197 fields

Ran twice:

```bash
pnpm eval:derive-seeds
```

Then checked:

```bash
git diff -- examples/eval/users/elena-marquez/seed-preferences.generated.json
```

No diff was produced after the deterministic rerun.

Ran a one-off Node contract/path check that parsed schemas, profile YAML,
manifest, field map, and scenario; verified all corpus document paths resolve;
verified the I-9 field map has 48 entries matching `fields.generated.json`; and
verified every referenced fact key exists in `profile.yaml`, allowing null
values.

Ran stale-reference checks:

```bash
rg "simple/seed-preferences.json|containsI9UsefulInfo|containsTelephoneValue|factHints|canonicalFactsForReview" examples/eval
rg "examples/eval/users/elena-marquez/(simple|realistic)" apps/backend apps/web examples/eval
rg "elena-marquez" apps/backend apps/web
```

All returned no matches.

Confirmed removed legacy paths:

```bash
test ! -e examples/eval/users/elena-marquez/simple
test ! -e examples/eval/users/elena-marquez/realistic
test ! -e examples/eval/users/elena-marquez/corpora/realistic/README.md
```

All passed.

## Follow-Ups

- Batch 2 resolved the validator follow-ups by adding `pnpm eval:validate`,
  validating profile-backed field-map, manifest, scenario, intentional-missing,
  and seed references, and checking seed values against the real backend
  preference catalog.
- Batch 2 kept manifest `documents[].factKeys` named `factKeys`, but made the
  entries leaf-only profile fact references.
- Batch 2 made `detailTier` a pure richness scale (`hero`, `medium`, `brief`);
  noise semantics now live in document `category` and `expectedUse`.
- Batch 4 should document fill-time rendering for array facts mapped into
  scalar PDF fields.
- Future runner work should decide expected snapshot shape for
  `elena-marquez-i9-section1`.
- Future field-map work should decide whether unlabeled I-9 citizenship
  checkboxes can be mapped safely from widget position or improved field
  extraction, including whether the field-map schema needs conditional or
  discriminator-style mappings.
