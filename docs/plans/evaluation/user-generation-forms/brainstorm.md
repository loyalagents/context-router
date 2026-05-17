# Reusable Synthetic User Corpora and Form-Fill Evaluation

- Status: brainstorming
- Read when: planning reusable synthetic users, realistic document corpora, and form-fill evaluation fixtures
- Source of truth: future `examples/eval/**`; current inputs are `examples/form-fill-demo/**`, `examples/memory-demo/**`, and `examples/memory-demo-simple/**`
- Last reviewed: 2026-05-17

## Purpose

We want a repeatable way to create realistic synthetic user document corpora for demos and evaluation.

The immediate use case is form-fill:

- define one synthetic user
- target one or more forms for that user
- generate a realistic local document corpus for that user
- import or analyze the corpus
- fill the target forms from extracted memory
- compare the result against expected outputs

The current manual workflow is too iterative:

1. Ask an agent to create realistic documents for a user.
2. Receive many documents that are often too thin, repetitive, or uniformly useful.
3. Ask the agent to inspect the documents and improve unrealistic files.
4. Repeat until the corpus feels plausible.

The goal is to reduce that loop without building a heavyweight product system.

The sharper framing is: generated documents are not the product. They are fixtures for evaluating whether the system can extract, remember, and use user facts correctly.

## Updated Assumption: Old Demo Trees Are Dispensable

The old demo examples can be removed:

- `examples/memory-demo/`
- `examples/memory-demo-simple/`

That changes the preferred direction. We do not need to preserve compatibility with the old directory shape or keep grafting new evaluation work onto historical demo folders.

Instead, create one clean canonical evaluation tree and migrate only the pieces that earned their place:

- form-fill PDFs and generated form field manifests
- the Elena-style realistic corpus pattern
- the memory-demo scenario pattern: `scenario.json`, `start/prompt.md`, and committed `expected/*.json`
- relevant schemas if they still fit the new shape

The cleanup should still be staged. Avoid one large PR that deletes old examples, moves fixtures, invents schemas, adds templates, adds validation, and adds a runner all at once.

## Core Model

Separate these concepts:

- **User**: stable synthetic identity and facts, such as legal name, DOB, SSN, citizenship, address, household, employment, and tax details.
- **Corpus**: one generated document set for a user, with a manifest, documents, and validation report.
- **Form**: a target fillable form and its generated field metadata.
- **Scenario**: one evaluation run that combines a user, corpus, form, prompt, and expected outputs.
- **Template**: a reusable document archetype that renders one realistic document from profile facts.

This distinction matters because one user can have many corpora, and many scenarios can reuse the same user and corpus.

## Target Directory Shape

Recommended canonical home:

```text
examples/eval/
  forms/
    <formId>/
      form.pdf
      fields.generated.json
      fake-user-requirements.generated.md
  users/
    <userId>/
      profile.yaml
      seed-preferences.generated.json
      realistic/
        manifest.json
        validation-report.json
        documents/
          identity/
          address-contact/
          hr-onboarding/
          payroll-tax/
          housing/
          education/
          partial-conflicting/
          noise/
  scenarios/
    <scenarioId>/
      scenario.json
      start/
        prompt.md
        local-memory.md
      expected/
        filled-form.json
        written-preferences.json
        final-preferences.json
  templates/
    identity/
      driver-license.md.hbs
      passport-application.md.hbs
    address-contact/
      lease-summary.md.hbs
    hr-onboarding/
      offer-letter.md.hbs
    payroll-tax/
      w4-draft-header.md.hbs
    noise/
      recipe-notes.md.hbs
  schemas/
    profile.schema.json
    manifest.schema.json
    scenario.schema.json
    fields.schema.json
  scripts/
    generate-field-manifests.mjs
    scaffold.mjs
    validate.mjs
    run-eval.mjs
```

V1 can keep one corpus per user at `users/<userId>/realistic/`.

If multi-corpus needs show up, promote that folder to:

```text
users/<userId>/corpora/<corpusId>/
```

Keep `profile.yaml` at the user level either way so this migration is cheap.

`seed-preferences.generated.json` should be derived from `profile.yaml`, not hand-maintained as a second source of truth. Use a small declaration in `profile.yaml` to say which facts should be projected into MCP seed preferences for a baseline run.

`local-memory.md` should be scenario-scoped. It represents a starting input channel for a particular evaluation scenario, not a stable property of the synthetic user.

## One User, Many Forms

The intended model is one coherent synthetic user whose documents support multiple forms.

Example:

```bash
pnpm eval:scaffold \
  --user nina-patel \
  --form i-9 \
  --form fw4 \
  --count 120 \
  --noise 30% \
  --conflict 5%
```

This should not create two users. It should create one user whose documents contain enough facts to support both forms.

Real documents naturally overlap:

- legal name, SSN, and address may support I-9, W-4, FAFSA, lease, payroll, and benefits flows
- citizenship and work authorization facts may support I-9
- filing status, dependents, and extra withholding may support W-4
- housing and household facts may support rental or benefits forms
- unrelated documents should exist as realistic noise
- stale or conflicting records should test whether agents prefer current high-authority facts

The validator should report coverage per form while treating the corpus as one user.

## Pipeline

The desired pipeline is:

```text
profile.yaml + forms + corpus policy
  -> scaffold manifest
  -> render documents from templates
  -> validate corpus
  -> run eval scenario
  -> compare against expected outputs
  -> optionally polish documents with an LLM
```

The key shift is to stop asking an agent to "make 100 realistic documents" in one freeform pass.

The scripts should define the shape and checks. Agents can still help with design, template creation, repair, and optional polish, but the deterministic path should be useful on its own.

## Profile Is The Source Of Truth

`profile.yaml` should be the only canonical source of user facts.

Do not duplicate canonical facts into `manifest.json`. Duplicating facts creates drift once users are regenerated or once a user has more than one corpus.

Example sketch:

```yaml
schemaVersion: 1
userId: nina-patel
identity:
  legalName: Nina Meera Patel
  firstName: Nina
  middleName: Meera
  lastName: Patel
  dateOfBirth: 1993-03-14
  syntheticSsn: 000-00-0393
address:
  current:
    street: 742 Maple Ridge Lane
    city: Austin
    state: TX
    zip: "78704"
workAuthorization:
  citizenshipStatus: U.S. citizen
tax:
  filingStatus: Single
  extraWithholding: 25
contact:
  email: nina.patel@example.test
mcpSeed:
  - identity.legalName
  - contact.email
  - address.current
```

The manifest may include a review summary derived from `profile.yaml`, but scripts should never treat copied facts in the manifest as authoritative.

`seed-preferences.generated.json` is a projection of the declared `mcpSeed` facts into the preference shape expected by the eval runner. It should be generated by scripts and treated as disposable output.

## Manifest Is A Corpus Inventory

The manifest should describe one corpus instance:

- which user it belongs to
- which forms it targets
- which documents should exist
- which templates rendered those documents
- which facts each template is expected to place
- which intentionally missing facts should remain absent
- which distribution policy created the corpus
- which deterministic seed was used, if the default `userId + corpusId` seed is not enough

Example sketch:

```json
{
  "schemaVersion": 1,
  "userId": "nina-patel",
  "corpusId": "realistic",
  "seed": "nina-patel:realistic",
  "forms": ["i-9", "fw4"],
  "purpose": "Synthetic realistic corpus for multi-form form-fill evaluation.",
  "distribution": {
    "targetDocumentCount": 120,
    "noiseRatio": 0.3,
    "conflictRatio": 0.05
  },
  "intentionallyMissing": [
    {
      "factKey": "contact.phone",
      "forms": ["i-9"],
      "fieldLabels": ["Telephone Number"],
      "reason": "Test blank-field behavior.",
      "expectedBehavior": "Do not guess or write a placeholder value."
    }
  ],
  "documents": [
    {
      "id": "001",
      "path": "documents/identity/001-driver-license-transcript.md",
      "template": "identity/driver-license.md.hbs",
      "category": "identity",
      "title": "Driver License Transcript",
      "relatedForms": ["i-9", "fw4"],
      "factKeys": ["identity.legalName", "identity.dateOfBirth", "address.current"],
      "detailTier": "hero",
      "authority": "high",
      "freshness": "current",
      "expectedUse": "extract"
    },
    {
      "id": "081",
      "path": "documents/noise/081-recipe-notes.md",
      "template": "noise/recipe-notes.md.hbs",
      "category": "noise",
      "title": "Recipe Notes",
      "relatedForms": [],
      "factKeys": [],
      "detailTier": "medium",
      "authority": "low",
      "freshness": "current",
      "expectedUse": "ignore"
    }
  ]
}
```

Prefer `factKeys` over handwritten `factHints`. If the document is rendered from a template, the template should declare or generate the fact keys it places. That makes the manifest more validator-trustable.

Use `intentionallyMissing[].factKey` rather than one-off booleans such as `containsTelephoneValue`. Different corpora will test different missing facts.

Every random choice in scaffold and template rendering should come from a seeded RNG. The default seed should be derived from `userId + corpusId`; an explicit manifest `seed` can override that if needed. Do not use wall-clock time or unseeded randomness in deterministic generation.

## Form Requirements

The scaffold and validator should derive form requirements from `fields.generated.json`.

`fake-user-requirements.generated.md` is useful human context, but scripts should prefer the machine-readable field manifest.

The system needs a fact-to-form mapping convention:

```text
form field key or label -> canonical fact key
```

Examples:

- I-9 first name -> `identity.firstName`
- I-9 date of birth -> `identity.dateOfBirth`
- W-4 SSN -> `identity.syntheticSsn`
- W-4 address -> `address.current`
- W-4 extra withholding -> `tax.extraWithholding`

Form coverage goals should be derived rather than manually retyped in every corpus manifest.

## Schema Versioning

`profile.yaml`, `manifest.json`, `scenario.json`, and `fields.generated.json` can version independently. A bump to one schema does not imply a bump to all of them.

For V1, the validator should support only the current schema versions. Old fixtures should be migrated rather than silently accepted through compatibility branches.

## Templates As The V1 Generator

Templates should move from "future option" to the recommended deterministic generation path.

Why:

- they prevent the "100 uniformly shallow documents" failure mode
- they guarantee fact placement
- they make generation reproducible from `profile.yaml` and a seed
- they are cheaper than asking an agent to write every corpus from scratch
- they let one template library support many users and forms

Start with a small library of document archetypes that cover the categories already proven useful by the Elena corpus:

- driver license transcript
- passport application draft
- SSN card transcript
- background check profile
- lease summary
- utility account header
- offer letter
- HRIS profile export
- payroll profile
- W-4 draft header
- direct deposit redacted summary
- work authorization note
- stale address note
- outdated resume
- unrelated recipe or grocery note
- unrelated package tracking or reservation note

Cap template growth. Prefer one reusable template per `(category, document-archetype)` and vary values, dates, redactions, and missing-field rendering through parameters.

Avoid mega-templates. A template may parameterize values, dates, redactions, and missing-field rendering, but it should not parameterize file format or document type. Different formats and document types should usually be separate templates.

An optional LLM polish step can later rewrite rendered documents for texture, but it must preserve facts and pass validation before output is accepted.

## Validation

The validator is the highest-leverage script. Build it before investing heavily in generation automation.

It should write `validation-report.json` and produce a clear pass/fail summary.

Initial deterministic checks:

- manifest shape is valid
- referenced `profile.yaml` exists and validates
- referenced forms exist and have `fields.generated.json`
- all `manifest.documents[].path` files exist
- document count matches the manifest distribution policy
- every document has category, title, related forms, template, fact keys, authority, freshness, detail tier, and expected use
- required form facts are backed by at least one current or acceptable document, unless intentionally missing
- intentionally missing facts do not appear in source documents
- high-authority current documents exist for important facts
- stale or conflicting documents are present when requested
- noise documents exist and are marked as `expectedUse: "ignore"`
- employer or third-party facts are not incorrectly marked as employee facts
- files are not all too short for their category and detail tier
- hero files are richer than medium files
- repeated boilerplate stays below a loose threshold for the category and detail tier
- deterministic rendering can re-render from the same seed without changing committed output
- scenario expected outputs are consistent with profile and corpus policy

Do not require every fact in `profile.yaml` to appear in every corpus. That becomes too strict as profiles grow. Require coverage for:

- facts needed by the selected forms
- facts explicitly included in the corpus policy
- facts referenced by expected scenario outputs

Start lax on style checks. Length and repetition thresholds should be configurable by category or detail tier, or treated as warnings only. A 25-word noise note may be fine; a 25-word lease summary is probably broken.

## Repair Loop

Repair should be report-driven, not open-ended.

Bad repair prompt:

```text
Look through all documents and make them more realistic.
```

Better repair workflow:

1. Run validation.
2. Read `validation-report.json`.
3. Patch only the listed files, templates, profile facts, or manifest entries.
4. Rerun validation.

Auto-repair is not needed for V1. Humans or agents can repair issues from the report. A dedicated repair command can come later if the pattern repeats.

## Eval Scenarios

The corpus should feed snapshot-style evaluation.

Scenario shape:

```text
examples/eval/scenarios/<scenarioId>/
  scenario.json
  start/
    prompt.md
  expected/
    filled-form.json
    written-preferences.json
    final-preferences.json
```

Example `scenario.json` sketch:

```json
{
  "schemaVersion": 1,
  "scenarioId": "nina-i9-fw4-i9-fill",
  "description": "Fill I-9 Section 1 from Nina Patel's multi-form realistic corpus.",
  "userId": "nina-patel",
  "corpusId": "realistic",
  "formId": "i-9"
}
```

Expected snapshot paths should be conventional, not repeated in `scenario.json`:

- `expected/filled-form.json`
- `expected/written-preferences.json`
- `expected/final-preferences.json`

If a scenario needs only a subset, add an optional `expectedSnapshots` array such as `["filled-form"]` rather than hard-coding paths.

The eval runner should:

1. Resolve the user, corpus, and form.
2. Reset or seed the test user's memory.
3. Analyze or import the corpus.
4. Run the form-fill flow.
5. Compare actual outputs with committed expected snapshots.
6. Classify each field as `correct`, `skipped-correctly`, `hallucinated`, or `missing`.
7. Write a report with per-scenario and aggregate results.

Snapshot updates should be deliberate. If a model or form-fill behavior changes legitimately, use a future `--update-snapshots` flow that requires reviewing diffs.

## Scripts And Commands

Prefer one script namespace:

```bash
pnpm eval:manifests
pnpm eval:validate --user nina-patel --corpus realistic
pnpm eval:scaffold --user nina-patel --form i-9 --form fw4 --count 120
pnpm eval:run --scenario nina-i9-fw4-i9-fill
```

Potential future commands:

```bash
pnpm eval:render --user nina-patel --corpus realistic
pnpm eval:polish --user nina-patel --corpus realistic
pnpm eval:update-snapshots --scenario nina-i9-fw4-i9-fill
```

Keep scripts under `examples/eval/scripts/` at first. Do not create a new workspace package unless these tools need dependencies or reuse outside evaluation fixtures.

## Scripts Vs Agent Skills

Scripts should be the reliability layer.

A skill or repo playbook can still help agents follow the workflow, especially while generation and repair are partly human-guided. But the skill should not be load-bearing.

Recommended split:

- scripts: schema checks, scaffold, deterministic template rendering, validation, eval runner
- templates: document content structure and fact placement
- agent/playbook: how to create or adjust profiles, add templates, interpret validation failures, and perform optional polish

If the scripts fully encode the workflow later, the skill becomes mostly contributor documentation.

## Options

### Option 1: Prompt Pack Only

Create a reusable prompt/checklist for generating realistic documents.

Pros:

- fastest to start
- no code
- works in any agent

Cons:

- still inconsistent
- hard to measure form coverage
- easy to regress into thin or repetitive documents

Use when: one-off corpora with a low quality bar.

### Option 2: Skill Or Playbook Only

Create a Codex/Claude-compatible skill that defines the corpus workflow.

Pros:

- reusable
- low implementation cost
- captures agent-specific guidance
- can explain realism expectations clearly

Cons:

- relies on agent discipline
- validation remains subjective unless paired with scripts

Use when: improving the manual loop before scripts exist.

### Option 3: Manifest-First Manual Generation

Require a manifest before writing documents.

Pros:

- big quality improvement for little complexity
- makes the intended corpus reviewable before generation
- avoids 100 uniformly shallow documents
- aligns with the existing Elena corpus pattern

Cons:

- manifest authoring can be tedious
- still needs manual or agent-written document bodies

Use when: we want better quality now with minimal code.

### Option 4: Validator First

Add deterministic validation and a machine-readable report before automating generation.

Pros:

- highest leverage reliability layer
- reduces manual review loops
- gives humans and agents specific repair targets
- useful even with existing hand-written corpora

Cons:

- cannot catch every realism issue
- requires choosing thresholds and coverage rules

Use when: building the first durable piece.

### Option 5: Template-Based Generation

Maintain reusable templates for common document types.

Pros:

- deterministic
- easy to guarantee fact placement
- cheap to run
- reliable for repeated users and forms
- avoids repeated multi-hour agent generation sessions

Cons:

- can feel templated
- requires template maintenance
- less flexible for novel forms

Use when: building the preferred V1 generator.

### Option 6: Hybrid Template Plus LLM Polish

Use templates for structure, then ask a model to rewrite each document while preserving facts.

Pros:

- balances control and realism
- templates guarantee coverage
- model adds variation and texture

Cons:

- needs fact-preservation validation
- adds cost and nondeterminism
- should usually commit polished output instead of regenerating it every run

Use when: deterministic corpora work but need more demo polish.

### Option 7: Factory Or Archetype Generation

Create user factories and archetypes such as:

- US-citizen-new-grad-renting
- naturalized-citizen-mid-career-homeowner
- lawful-permanent-resident-parent-of-two
- low-income-public-benefits-applicant

Pros:

- coherent users at larger scale
- useful for fuzzing and broader evaluation
- each archetype can target specific behaviors

Cons:

- curated maintenance work
- premature before a few hand-authored users prove the flow

Use when: the framework has a stable schema, validator, templates, and runner.

## Recommended Direction

Recommended direction after accepting that old examples can be removed:

1. Build one canonical `examples/eval/` tree.
2. Treat `profile.yaml` as the single source of truth for user facts.
3. Keep corpus manifests as inventories, not duplicated fact stores.
4. Derive form requirements from `fields.generated.json`.
5. Build the validator before the generator.
6. Use templates as the deterministic V1 generation mechanism.
7. Add snapshot-style eval scenarios as the real end goal.
8. Keep optional LLM polish and agent skills as later helpers.

This is still not a backend product feature. It should remain local fixture and script infrastructure unless future needs prove otherwise.

## Rough Implementation Plan

### Phase 0: Cleanup And Location Decision

Goal: stop spreading evaluation fixtures across three demo trees.

Tasks:

- pick `examples/eval/` as the canonical home, or explicitly decide to keep `examples/form-fill-demo/` and rename later
- move form-fill forms and generated field manifests into the canonical tree
- move the Elena corpus as the first realistic corpus example
- migrate only useful memory-demo ideas: scenario manifests, expected snapshots, and relevant schemas
- remove `examples/memory-demo/` and `examples/memory-demo-simple/`
- update root package scripts that reference old locations

Keep this as a cleanup step. It should not also implement the validator, templates, and eval runner.

Concrete migration target:

- move `examples/form-fill-demo/forms/<formId>/` directories to `examples/eval/forms/<formId>/`
- move `examples/form-fill-demo/scripts/generate-field-manifests.mjs` to `examples/eval/scripts/generate-field-manifests.mjs`
- move `examples/form-fill-demo/users/elena-marquez/` as the first realistic user/corpus example, adapting only enough shape to fit Phase 1
- migrate `examples/memory-demo/schemas/` only if the new schemas actually inherit useful pieces

Concrete deletion or recreation candidates:

- delete `examples/memory-demo/scripts/verify.mjs`; `validate.mjs` replaces its schema and file-walk role
- delete old `examples/memory-demo/scenarios/`; recreate scenarios under the new shape instead of carrying paths forward
- delete old `examples/memory-demo/templates/`; new templates should live under `examples/eval/templates/`
- delete `examples/memory-demo-simple/` entirely
- drop or later recreate old lightweight users such as Alex Rivera and Maya Chen under the new schema if they remain useful

### Phase 1: Schema And Example Contracts

Goal: establish the data contracts.

Tasks:

- define `profile.yaml`
- define `manifest.json`
- define `scenario.json`
- define or migrate JSON Schemas
- define fact key naming conventions
- define form-field-to-fact mapping conventions
- document how one user can target many forms

Checkpoint output:

- committed schema docs and examples
- no generation automation required yet

### Phase 2: Validator

Goal: make corpus quality inspectable and repeatable.

Possible command:

```bash
pnpm eval:validate --user elena-marquez --corpus realistic
```

Responsibilities:

- validate profile, manifest, scenario, and field schemas
- check form coverage
- check intentionally missing facts
- check document inventory
- check category and distribution rules
- check obvious realism problems such as very thin or duplicated docs
- write `validation-report.json`

Use the migrated Elena corpus to prove the validator rules.

The useful parts of old `memory-demo/scripts/verify.mjs` belong here, not in the eval runner. Retain only pieces that still fit the new shape, likely schema validation and file-existence walking.

### Phase 3: Templates And Scaffold

Goal: make corpus generation deterministic.

Possible command:

```bash
pnpm eval:scaffold --user nina-patel --form i-9 --form fw4 --count 120
```

Responsibilities:

- create user and corpus folders
- create a `profile.yaml` template if one does not exist
- derive form requirements from `fields.generated.json`
- select templates using form requirements and distribution policy
- render documents from templates
- write `manifest.json`
- run or prompt for validation

For V1, it is acceptable for scaffold to create a fill-in `profile.yaml` template and refuse to render documents until required profile facts are present.

All choices in this phase should use seeded deterministic generation. Derive the default seed from `userId + corpusId`, with an explicit manifest seed as an escape hatch.

### Phase 4: Eval Runner

Goal: close the loop from corpus to form-fill quality.

Possible command:

```bash
pnpm eval:run --scenario nina-i9-fw4-i9-fill
```

Responsibilities:

- resolve scenario references
- reset or seed memory
- import or analyze corpus documents
- run form-fill
- compare actual output to committed expected snapshots
- write per-field and aggregate reports

This phase turns the generated corpus into a real evaluation fixture rather than just a demo data folder.

### Phase 5: Optional LLM Polish

Goal: improve realism while preserving deterministic safety.

Possible command:

```bash
pnpm eval:polish --user nina-patel --corpus realistic
```

Responsibilities:

- rewrite rendered template output for more realistic variation
- preserve all facts and intentionally missing values
- rerun validation before accepting changes
- make polished output reviewable and commit-worthy

This should be optional. The deterministic template path should remain useful without it.

### Phase 6: Optional Agent Skill Or Playbook

Goal: help Codex, Claude Code, and other agents use the framework consistently.

Responsibilities:

- explain the schema and eval flow
- explain how to add or adjust profiles
- explain how to add templates
- explain how to interpret validation reports
- explain how to do report-driven repairs

This is useful contributor guidance, but scripts and templates should carry the core reliability.

## Open Questions

- Should V1 use `users/<userId>/realistic/` or start immediately with `users/<userId>/corpora/<corpusId>/`?
- How rich should the fact key vocabulary be before templates are added?
- Should form-field-to-fact mappings live beside forms, schemas, or templates?
- How strict should validation be about document length and repeated boilerplate?
- Should canonical rendered corpora always be committed, or should only some corpora be committed as snapshots?
- How much of memory-demo's old verifier shape should be retained in `validate.mjs`?
- Should snapshot updates require a separate review command from normal eval runs?
- What is the minimum template set that covers I-9 and W-4 well enough to prove the flow?

## Current Lean

- Use one canonical `examples/eval/` tree.
- Delete `examples/memory-demo/` and `examples/memory-demo-simple/` after migrating useful ideas.
- Keep cleanup separate from schema, validator, and runner work.
- One user can target many forms.
- `profile.yaml` is the user fact source of truth.
- Manifest facts should be derived or referenced, not authoritative duplicates.
- `seed-preferences.generated.json` should be derived from `profile.yaml`; `local-memory.md` should be scenario-scoped.
- Validation should report per-form coverage and corpus-level realism issues.
- Build validator before generation automation.
- Use templates as the V1 generator.
- Use seeded deterministic rendering, defaulting to `userId + corpusId`.
- Keep `--count` as a convenience, but allow distribution controls such as `--noise` and `--conflict`.
- Commit canonical demo corpora for stable demos; consider on-demand generation later for fuzzing.
- Keep this as fixture/script infrastructure unless there is evidence it needs to become a backend feature.
