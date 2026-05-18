# PR Feedback: Batch 1 Schema Contract Implementation

- Reviewer: Claude (Opus 4.7)
- Date: 2026-05-17
- Reviewing: working-tree diff for Batch 1 (`docs/plans/evaluation/user-generation-forms/schema-contract/`)
- Reproduced locally: ran `pnpm eval:derive-seeds` twice (no diff), ran the stale-reference greps (clean), ran a one-off Node check against schemas/profile/manifest/field-map/scenario (all consistent: 100 doc paths resolve, 48/48 field-map entries, all `factKey` references resolve in `profile.yaml`, all scenario refs resolve).

## Overall

Mechanically clean. The contract decisions from the plan landed faithfully: V1 schemas, profile-as-source-of-truth, deterministic seeds, manifest as inventory, exhaustive I-9 field-map, scenario fixture, deleted legacy paths and corpus README, retired legacy keys (`canonicalFactsForReview`, `factHints`, etc.). The 100-document factKey rewrite matches the mapping table in the plan. Deterministic seed output verified on rerun. Documentation is internally consistent across README, user README, scenario prompt, forms-notes, orchestration plan, and implementation summary.

The issues below are not blockers — but one is a real architectural decision that will skew Batch 2 and Batch 4 if left.

## Worth Addressing Before Batch 2

### 1. `not_applicable` in `forms/i-9/field-map.json` is user-specific in a form-scoped artifact

The field-map lives at `forms/i-9/field-map.json` and is described as a global form artifact. But four entries treat user-specific facts as `not_applicable` because they're inapplicable *to Elena*:

- fieldIndex 0 `3 A lawful permanent resident Enter USCIS or ANumber` — "Elena is a U.S. citizen, so the lawful permanent resident USCIS/A-number subfield does not apply."
- fieldIndex 23 `Exp Date mmddyyyy` — "Work authorization expiration date does not apply to Elena as a U.S. citizen."
- fieldIndex 24 `USCIS ANumber` — "USCIS/A-number does not apply to Elena as a U.S. citizen."
- fieldIndex 25 `Form I94 Admission Number` — "Form I-94 admission number does not apply to Elena as a U.S. citizen."
- fieldIndex 26 `Foreign Passport Number and Country of IssuanceRow1` — "Foreign passport fields do not apply to Elena as a U.S. citizen."

The moment a non-citizen synthetic user (LPR, work-authorized) reuses this same I-9 field-map, these `not_applicable` entries are wrong, and the implementer would have to either:

- fork field-maps per user (defeating the form-scoped design), or
- rewrite these entries as `mode: "fact"` with new fact keys (e.g., `workAuthorization.uscisANumber`, `workAuthorization.workAuthorizationExpiration`, `workAuthorization.i94Number`, `workAuthorization.foreignPassport`) and let profile.yaml declare them as `null` for users they don't apply to — which is the pattern the plan already established for `contact.phone`.

Recommendation: lean on the same pattern. Convert these five entries to `mode: "fact"` and add the corresponding null-valued facts to Elena's profile. Reserve `not_applicable` for fields that are inapplicable *to the form itself in any context*, not to a particular synthetic user.

The implementer's note on fieldIndex 38 (`FirstDayEmployed mmddyyyy` — "Employee first day of employment is a Section 2 employer field in this fixture") hints at the same tension going the other way: Elena *does* have `employment.startDate`, but the field is treated as `out_of_scope` because of where the form puts it. That's defensible as a scenario decision — but if scenario decisions live in the field-map, the field-map is implicitly scenario-scoped, not form-scoped. Worth deciding before Batch 2 writes the validator and Batch 4 writes the runner.

## Design Tensions Worth Surfacing

### 2. `detailTier` enum mixes two orthogonal dimensions

`manifest.schema.json` enum is `["hero", "medium", "noise"]`. The brainstorm framed `detailTier` as document *richness* ("hero files are richer than medium files"). But `noise` is a category, not a tier — and the data shows the confusion:

- doc 084 `Workout Plan` (noise category, `expectedUse: ignore`) → `detailTier: "hero"`
- doc 095 `GitHub Profile Snippet` (noise category, `expectedUse: ignore`) → `detailTier: "hero"`
- doc 100 `Manual Signature Reminder` (noise category, `expectedUse: guardrail`) → `detailTier: "hero"`
- docs 088, 091, 093 (noise category) → `detailTier: "noise"` but `authority: "medium"`

So `detailTier: "hero"` means two different things depending on category, and `noise` does double-duty as both a category and a tier value. Either:

- (a) drop `noise` from the enum and let `category` carry "this is a noise doc" — `detailTier` becomes a pure richness scale.
- (b) rename `detailTier` to something like `weight` and have the enum better reflect what it actually means.

This isn't urgent but Batch 2's validator will want a rule like "length thresholds keyed off `detailTier`," and the rule will be incoherent if `detailTier: noise` and `detailTier: hero` are simultaneously valid for the same category.

### 3. `factKey` is overloaded across the contracts

The same field name means two different things:

- In `field-map.json`, `factKey` is a **leaf reference**: `address.current.street`, `identity.firstName`. The fill-time runner will read this one value.
- In `manifest.json` `documents[].factKeys`, `factKey` is a **content marker**: `address.current` (the whole address object), not a leaf. It says "this document mentions the address area."

Both currently validate as `factKey` references against `profile.yaml` (mine did), but only because `profile.yaml`'s nested structure happens to make intermediate paths valid. The contract doesn't say which kind of reference each context expects, and Batch 2's validator will need a rule.

Recommendation: name them differently. `field-map` entries use `factKey` (leaf-required); `manifest` documents use `factAreas` or `mentionedFacts` (non-leaf permitted). Or keep one name and document the leaf-vs-area rule explicitly.

### 4. Array facts → scalar fields: value rendering rule isn't in the contract

`identity.otherLastNames` is an array (`["Ruiz"]`) in profile.yaml. The I-9 field "Employee Other Last Names Used (if any)" (fieldIndex 4) is a single text field. The field-map maps `factKey: "identity.otherLastNames"` to it anyway. At fill time, the runner has to join/render the array as a string.

The plan's "strict 1:1 projection, no joining" rule was scoped to `seedPreferences[]`. The field-map → fill-time path is separate, and the contract doesn't say so. Worth one sentence in `examples/eval/README.md`:

> Seed projection is strict 1:1 (no joining/coercion). Field-map fill-time rendering is the runner's responsibility and is allowed to render array facts as scalars (e.g., comma-joined) when the form field is scalar.

Otherwise a future contributor will read the "no joining" rule and wonder why the I-9 field-map points a text field at an array fact.

## Smaller Items

### 5. Citizenship checkboxes deferred

`CB_1` through `CB_4` and `CB_Alt` all use `mode: "skip", reason: "unmapped"` with notes like "Generated metadata does not expose a reliable label for this citizenship checkbox yet." This is correctly punted to a future batch. The implementation summary calls this out as a follow-up. Good.

When this is unblocked, the four citizenship checkboxes will need to be driven by `workAuthorization.citizenshipStatus`. That's a one-fact-to-four-fields mapping that the current discriminated-union schema doesn't express. Batch 4 may need a small extension (e.g., `mode: "fact-discriminator"` or a small inline conditional). Worth noting now so the schema author doesn't get surprised.

### 6. `intentionallyMissing[].forms` values aren't cross-checked against top-level `manifest.forms[]`

Schema permits any string in `intentionallyMissing[].forms` and any string in top-level `forms`. If a future corpus declares `forms: ["fw4"]` and `intentionallyMissing[0].forms: ["i-9"]`, the schemas validate but the meaning is incoherent. Batch 2's validator should catch this; not urgent.

### 7. `seedPreferences[]` slug uniqueness not enforced

`profile.schema.json` allows duplicate slugs in `seedPreferences[]`. The seed script would produce duplicate output rows (with `localeCompare` ordering they'd land adjacent). Cheap schema fix: add `uniqueItemProperties: ["slug"]` via a `oneOf`/contains pattern, or leave it to Batch 2.

### 8. Empty-array fact handling in seed projection

`generate-seed-preferences.mjs` drops null values with `if (value == null) continue;`. It does NOT drop empty arrays. If `communication.preferredChannels: []`, the output would emit `value: []`. Reasonable (an explicit empty list is data), but worth documenting — the contract should say whether empty collections are emitted or skipped, since `null` is the only currently documented "absent" marker.

### 9. `forms-notes.md` update is fine but minimal

The forms-notes file now points at `forms/<formId>/field-map.json` as the machine-readable mapping. Good. It still describes form coverage in prose. As more forms get field-maps, consider whether this file remains useful or rots — but that's a Batch 3/4 question, not a Batch 1 one.

### 10. Implementation summary follow-up list is missing the `factKey` cross-reference check

Summary lists "Batch 2 should validate profile fact types against MCP preference slug value types" but does not explicitly list "Batch 2 should validate factKey references resolve against `profile.yaml`" — which is the verifier the plan included as a one-off. Worth adding so Batch 2's scope is complete.

## Verdict

Ship. Item #1 (user-scoped `not_applicable` reasons leaking into a form-scoped artifact) is the only thing I'd address in this PR, and even that could be deferred to Batch 2 if you'd rather decide the field-map's user-scope question alongside the validator. Items #2–#4 are real design tensions that will surface in Batch 2/4 — flag them in the orchestration plan's "Batch 2 inputs" so they don't get rediscovered cold.
