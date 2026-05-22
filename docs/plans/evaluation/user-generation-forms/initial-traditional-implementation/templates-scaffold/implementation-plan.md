# Batch 3 Implementation Plan: Templates And Scaffold

## Summary

Implement deterministic local fixture generation under `examples/eval/` using trusted repo-local `.mjs` template modules. Templates should support many varied, realistic document archetypes while renderer/scaffold verification keeps profile fact use, metadata, and output determinism checkable.

This remains fixture/script infrastructure only: no backend product behavior, no scenario runner, and no LLM polish.

## Key Changes

- Add templates at `examples/eval/templates/<category>/<templateSlug>.mjs`.
- Each template exports `meta` and `render(helpers)`.
- Add `examples/eval/schemas/template.schema.json`.
- Add `examples/eval/scripts/scaffold.mjs`.
- Add root `eval:scaffold`.
- Replace `eval:validate:test` with one root `eval:test` running `node --test examples/eval/scripts/*.test.mjs`.
- Extract shared seed preference derivation so `generate-seed-preferences.mjs`, `validate.mjs`, and `scaffold.mjs` use one implementation.
- Clean up manifest contract in one migration:
  - add required `seed`
  - default seed is `<userId>__<corpusId>`
  - `--seed` override must match `^[a-z0-9_-]+$`
  - make `documents[].template` optional and omit it for hand-authored docs
  - remove `note`
  - remove `distribution` entirely
  - derive document count from `documents.length`
  - close `category` enum to `identity | address-contact | hr-onboarding | payroll-tax | work-authorization | employer-context | partial-conflicting | noise`
- Keep Elena’s hand-authored `realistic` corpus, but rewrite its manifest once for the cleanup.
- Add a small generated Elena corpus at `users/elena-marquez/corpora/template-smoke/`.

## Template Contract

Template `meta` fields:

```js
export const meta = {
  schemaVersion: 1,
  templateId: "hr-onboarding/offer-letter",
  category: "hr-onboarding",
  title: "Offer Letter",
  outputExtension: "md",
  requiredFactKeys: [],
  optionalFactKeys: [],
  detailTier: "hero",
  authority: "high",
  freshness: "current",
  expectedUse: "extract",
  defaultOrder: 30
};
```

Rules:

- `templateId` must match path, e.g. `templates/hr-onboarding/offer-letter.mjs` -> `hr-onboarding/offer-letter`.
- `category` must match the first path segment.
- `outputExtension` must be one of `md | txt | json | yaml`.
- Template modules are trusted repo-local fixture code, not sandboxed untrusted input.
- Template discovery sorts by `templateId`; no generation or validation step may depend on filesystem `readdir` order.
- Renderer verification must catch contract drift:
  - every metadata fact key is a profile leaf, not an area ref
  - every accessed fact is declared in `requiredFactKeys` or `optionalFactKeys`
  - every required fact is non-null and accessed during render
  - optional null/missing facts are omitted from generated manifest `factKeys`
  - repeated render with the same profile and seed is byte-identical

Helpers:

- `fact(factKey)`: returns a non-null scalar leaf; rejects missing, null, object, and array values.
- `maybeFact(factKey, formatter?)`: returns `""` for null/missing optional facts; otherwise returns `formatter(value)` or `String(value)`; rejects object and array values.
- `joinFact(factKey, separator)`: renders array leaves in profile order; rejects non-array values.
- `dateFact(factKey, format)`: formats ISO `YYYY-MM-DD` strings only; supports `iso`, `us`, and `long`.
- `choose(key, values)`: deterministic phrase selection using `hashInt(manifest.seed, templateId, key)`; `values` must be a non-empty array of strings.

Hash primitive:

```text
hashHex(...parts) = sha256(parts.join("\0")).digest("hex")
hashInt(...parts) = parseInt(hashHex(...parts).slice(0, 8), 16)
choose(key, values) = values[hashInt(manifest.seed, templateId, key) % values.length]
template order hash = hashInt(seed, templateId)
```

## Scaffold CLI

Render mode:

```bash
pnpm eval:scaffold --user <userId> --corpus <corpusId> --form <formId> [--form <formId>] [--count <n>] [--seed <seed>] [--missing <factKey>] [--scenario <scenarioId>] [--force]
```

Rules:

- `--form` requires existing `field-map.json`; V1 supports I-9 first.
- Required coverage includes only selected field-map entries with `mode: "fact"` whose fact key resolves to a non-null profile leaf.
- Null mapped facts do not require coverage. They may represent intentionally absent data or user-inapplicable facts.
- `--missing <factKey>` may repeat, but it does not affect template selection.
- `--missing` only writes `intentionallyMissing[]` entries for null facts referenced by selected forms.
- Scaffold rejects `--missing` if the fact is non-null, missing from the profile, an area ref, or not referenced by any selected form field map.
- Missing fact `forms` are derived from selected forms whose field maps reference that fact.
- Missing facts use deterministic default text:
  - `reason`: `This profile fact is explicitly null and intentionally absent from rendered documents.`
  - `expectedBehavior`: `Leave the field blank; do not guess or synthesize a value.`
- Generated manifest `purpose` is exactly `Generated template-scaffold corpus for <forms> form-fill evaluation.`, where `<forms>` is the selected form ids sorted and comma-joined.
- A template is eligible only if all `requiredFactKeys` are non-null leaves.
- Optional null/missing facts may be skipped.
- If no templates are selected, scaffold fails with a clear message instead of writing a zero-document corpus.
- If `--count` is omitted, scaffold renders exactly the required-coverage template selection and does not fill extra templates.
- If `--count` is provided, scaffold fills from eligible unselected templates up to that count.
- Existing corpus or scenario paths require `--force`.
- Scaffold-owned JSON uses two-space indentation and a trailing newline for `manifest.json`, `scenario.json`, and generated seed JSON.
- Scaffold writes template document render output verbatim; JSON/YAML document formatting is the template author’s responsibility.
- Scaffold imports shared seed derivation and writes only the target user’s `seed-preferences.generated.json`.
- Scaffold validates the generated corpus with `--write-report`.
- If validation fails, scaffold leaves generated files on disk and exits non-zero.

Scenario skeleton mode:

- `--scenario <scenarioId>` requires exactly one `--form`.
- Writes deterministic `scenario.json` and `start/prompt.md`.
- Generated `scenario.json` includes:
  - `description`: `Generated template-scaffold scenario for <displayName> using <formId>.`
  - `expectedSnapshots: []`
- Generated `start/prompt.md` is exactly:

```md
Fill <formId> for <displayName> using the seeded memory and corpus documents. Leave fields blank when the available facts do not support a value.
```

- No expected snapshots and no scenario execution are added in Batch 3.

Init mode:

```bash
pnpm eval:scaffold --init-user --user <userId> --display-name "<Name>" --form <formId>
```

Rules:

- Creates `profile.yaml` with nested `null` leaves for every selected field-map `mode: "fact"` fact key.
- Writes `seedPreferences: []`.
- Writes `seed-preferences.generated.json` as `[]\n`.
- Uses the existing `yaml` package with two-space indentation and trailing newline.
- Refuses if `users/<userId>/profile.yaml` already exists.
- Refuses if `users/<userId>/seed-preferences.generated.json` already exists without a profile, to avoid clobbering scaffold-owned output unexpectedly.
- `--force` does not override init-mode profile or seed-file protection.
- Does not create corpus documents, manifest, or scenarios.

## Template Selection

Selection is metadata-only. Render verification proves selected template metadata is honest. Only `requiredFactKeys` count toward selection coverage; `optionalFactKeys` are flavor and do not cover a required form fact during selection.

```text
requiredFacts = union(selected field-map factKeys where mode == "fact")
requiredFacts = keep only factKeys that resolve to non-null profile leaves
requiredFacts -= non-null seedPreferences coverage

eligibleTemplates = templates where all requiredFactKeys are non-null leaves

selected = []
uncovered = requiredFacts

while uncovered is not empty:
  pick eligible template covering the most uncovered facts via requiredFactKeys only
  tie-break by defaultOrder ASC, hashInt(seed, templateId) ASC, templateId ASC
  add template to selected
  remove template.requiredFactKeys from uncovered
  if no template covers an uncovered fact: fail

if --count is omitted:
  stop; selected is the full corpus template set

if --count < selected.length: fail
if --count > eligibleTemplates.length: fail
fill remaining slots from eligible unselected templates by defaultOrder ASC, hashInt(seed, templateId) ASC, templateId ASC
```

Known limitation: greedy selection is not guaranteed to find a mathematically minimal set cover. This is acceptable for the small hand-curated V1 template library.

Generated document paths and ordering:

```text
documents/<category>/<NNN>-<templateSlug>.<outputExtension>
```

- `documents[]` follows selection order, then fill order.
- `<NNN>` is a corpus-global 1-based sequence in that same order, formatted as three digits.
- Each template renders at most once per corpus.

Generated manifest `documents[].factKeys` are actual non-null accessed facts recorded during render.

For Elena’s I-9 `template-smoke`, the initial template library must cover these non-null, non-seed-covered field-map facts through `requiredFactKeys`:

```text
identity.middleInitial
identity.otherLastNames
identity.dateOfBirth
identity.ssn
address.current.street
address.current.unit
address.current.city
address.current.state
address.current.postalCode
```

## Checkpoints

1. Contract cleanup:
   - Update schemas and validator for `seed`, optional `template`, removed `note`, removed `distribution`, derived document count, category enum, and template metadata.
   - Remove `MANIFEST_DOCUMENT_COUNT_MISMATCH`.
   - Extract shared seed derivation and update seed generator plus validator to import it.
   - Rewrite Elena `realistic/manifest.json`.
   - Refresh Elena `realistic/validation-report.json`.
   - Test with `pnpm eval:test` and `pnpm eval:validate`.

2. Template renderer:
   - Add template discovery/import with sorted `templateId` order, helper instrumentation, shared hash primitive, deterministic `choose`, render verification, and byte-stable rerender checks.
   - Add at least 5 I-9-supporting templates across at least 3 categories.
   - Ensure the template set covers Elena’s I-9 required coverage facts listed above via `requiredFactKeys`.
   - Test renderer success and contract failures with `pnpm eval:test`.

3. Scaffold:
   - Add CLI parsing, `--init-user`, init-mode overwrite protection, metadata-only selection, omitted-`--count` behavior, deterministic purpose/scenario generation, path/id ordering, manifest writing, target-user seed derivation, and validation integration.
   - Generate `elena-marquez/template-smoke`.
   - Generate `elena-marquez-i9-template-smoke` scenario skeleton.
   - Test with `pnpm eval:test` and focused `pnpm eval:validate --user elena-marquez --corpus template-smoke`.

4. Validator integration:
   - Validate global template metadata.
   - Validate template id/path/category/output extension parity.
   - Validate manifest template references.
   - Confirm generated corpora pass existing field-map coverage validation.
   - Test with `pnpm eval:test` and `pnpm eval:validate`.

5. Docs and closeout:
   - Update `examples/eval/README.md`.
   - Add `templates-scaffold/implementation-summary.md`.
   - Update `orchestration-plan.md` status and current implemented state.
   - Run `rg "eval:validate:test"` and fix or annotate stale references after the `eval:test` rename.
   - Note schema cleanup decisions in prior summaries if needed.

## Test Plan

Add tests for:

- Template discovery and metadata schema validation.
- Discovery/order independence from filesystem `readdir` order.
- Shared hash primitive and `choose()` determinism by seed/template/key.
- Template path/id/category/output extension parity.
- Required fact missing, null, area ref, object, and array rejection.
- Null mapped form facts require no template coverage and no `--missing`.
- `fact()` rejecting arrays and `joinFact()` preserving array order.
- Optional null facts omitted from manifest `factKeys`.
- Accessed undeclared fact failure.
- Declared required fact not accessed failure.
- Date formats: `iso`, `us`, `long`, and unknown format rejection.
- `--seed` override persistence and effect on ordering/choices.
- Metadata-only template selection.
- Omitted `--count` renders exactly the required-coverage template set.
- Document order and `NNN` id assignment.
- `mode: skip` field-map entries excluded from required coverage.
- Scaffold `--missing` manifest output.
- Scaffold rejects `--missing` for non-null facts and facts not referenced by selected forms.
- Scaffold writes deterministic `purpose`.
- Scaffold-owned JSON uses two-space indentation and trailing newline.
- Scaffold writes template document output verbatim.
- Scaffold errors when `--count` is too small or too large.
- Scaffold fails rather than writing a zero-document corpus.
- Scaffold `--force` overwrite behavior.
- `--init-user` nested null profile shape and generated empty seeds.
- `--init-user` refuses when profile or orphaned generated seeds already exist.
- Scenario skeleton with pinned `description`, prompt body, and `expectedSnapshots: []`.
- Scenario skeleton rejects multiple `--form` values.
- Target-user-only seed derivation.
- Validation failure leaves generated files on disk and exits non-zero.
- Committed `template-smoke` corpus and scenario rerender cleanly.

Verification commands:

```bash
pnpm eval:derive-seeds
pnpm eval:test
pnpm eval:validate --user elena-marquez --corpus realistic
pnpm eval:validate --user elena-marquez --corpus template-smoke
pnpm eval:validate --scenario elena-marquez-i9-template-smoke
pnpm eval:validate
pnpm eval:scaffold --user elena-marquez --corpus template-smoke --form i-9 --scenario elena-marquez-i9-template-smoke --force
git diff --exit-code \
  examples/eval/users/elena-marquez/corpora/template-smoke \
  examples/eval/scenarios/elena-marquez-i9-template-smoke
```

## Assumptions

- V1 supports only forms with field maps; currently I-9 is the ready target.
- Templates are reusable document archetypes, not per-user one-offs.
- Batch 4 owns scenario execution and fill-time value serialization.
- Batch 5 may add optional LLM polish after deterministic generation is stable.
