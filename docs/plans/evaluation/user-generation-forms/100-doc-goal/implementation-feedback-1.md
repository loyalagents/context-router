# 100-Doc Implementation Plan Feedback 1

- Status: feedback
- Date: 2026-05-21
- Reviewed plan:
  `docs/plans/evaluation/user-generation-forms/100-doc-goal/implementation-plan.md`

## High-Level Take

This is a strong implementation plan. It correctly identifies the main shift:
the framework should own the deterministic rails, while AI authors the
realistic document bodies.

I agree with the main architecture:

```text
profile.yaml
  -> corpus-plan.json
  -> one document body per planned entry
  -> prose-aware validation
  -> committed corpus
  -> known-memory form-fill scenario
```

The two biggest changes I would make before implementation:

1. Split the work into smaller batches. The current checkpoint list is too much
   for one reviewable PR.
2. Do not make the Vertex-backed `eval:generate` command the first required
   generation path. Start with coding-agent generation from the plan, then add
   a script-called AI backend only after the plan, prose validation, and repair
   loop work.

## What I Agree With

I agree with using `samir-desai/corpora/realistic/` instead of
`realistic-v1`. Samir does not have an existing realistic corpus, and Elena has
already established `realistic` as the canonical large-corpus name.

I agree that prose validation cannot be deferred until after all 100 documents
exist. Once AI writes document bodies, manifest metadata alone is not enough.
At minimum, validation needs high-confidence checks for values like email, SSN,
USCIS/A-number, postal code, exact street address, full legal name, and work
email.

I agree with keeping document ingestion out of the first 100-doc corpus. The
known-memory form-fill runner still gives useful regression coverage, and
extraction scoring should be a separate runner/snapshot design.

I agree with the realism bar. Text fixtures in varied formats are the right
first target. Scanned PDFs, OCR artifacts, and visual documents would add too
much complexity before the basic 100-doc workflow is proven.

I agree that no AI should run in `eval:test`, `eval:validate`, `eval:verify`,
runner snapshots, or CI. Generated documents should be committed artifacts.

## Main Concerns

### 1. The Plan Is Too Large For One Batch

The plan combines all of these into one implementation sequence:

- corpus-plan schema
- plan-only validation
- distribution validation
- prose matching
- Elena calibration
- Samir 100-entry plan
- AI generation command
- generated 100-doc corpus
- scenario and snapshot
- extraction-eval design notes
- TODO updates

That is more than one reviewable PR. The riskiest parts are prose matching and
AI generation; those should not be bundled with the first full 100-doc corpus.

Recommended split:

1. **Plan Contract + High-Confidence Prose Validation**
   - Add `corpus-plan.schema.json`.
   - Add `--plan-only`.
   - Add high-confidence prose checks.
   - Calibrate on Elena.
   - No 100-doc generation yet.

2. **Samir Corpus Plan + Pilot Documents**
   - Add a 10-20 document pilot or preview corpus.
   - Generate with Codex/Claude Code from the plan.
   - Tune validation from real outputs.

3. **Full Samir Realistic Corpus**
   - Add the full 100-entry plan.
   - Generate 100 documents in batches.
   - Commit manifest, report, docs, and known-memory scenario snapshot.

4. **Optional Generation Command**
   - Add Vertex or command-backed generation only after the manual/coding-agent
     workflow proves the prompt contract and validation loop.

### 2. Script-Called Vertex Generation Is Premature

The implementation plan chooses:

```bash
pnpm eval:generate --user samir-desai --corpus realistic --backend vertex
```

I understand the argument: one isolated AI call per document can reduce shared
style and make generation shape reproducible. But I would still not start
there.

Reasons:

- It adds credentials, provider config, model choice, retries, rate limits,
  failure modes, and cost controls before the workflow is proven.
- It makes generation look like a normal repo command, even though it is a
  fixture-authoring operation that should be reviewed carefully.
- It forces provider-specific decisions into the first implementation.
- It may distract from the more important work: corpus-plan validation and
  prose-integrity checks.

Recommended change:

- Keep `eval:generate` out of the first implementation batch.
- Add a playbook section and prompt contract for Codex/Claude Code generation.
- Have an agent generate the first 10-20 pilot docs from `corpus-plan.json`.
- Revisit `eval:generate` after the pilot or after one full corpus proves the
  workflow.

If a generation command is still desired early, make the first backend a
`--backend manual` or `--backend command` style seam that prepares prompts and
expected output paths, but does not require direct provider SDK integration.

### 3. The Generator Should Not Own Manifest Semantics

The plan says the model returns only the body and the script copies metadata
from `corpus-plan.json` into `manifest.json`. That is good. Keep that invariant
strict.

The generator should not:

- invent `factKeys[]`
- decide `expectedUse`
- decide `freshness`
- change category or authority
- silently rewrite the plan

The plan should be the contract, and the manifest should be the committed
inventory derived from the plan plus actual files.

One detail to clarify before implementation: whether `brief` and
`challengeTags` live only in `corpus-plan.json` or also get copied into
`manifest.json`. My preference:

- `brief`: plan-only
- `challengeTags`: probably plan-only at first
- manifest: keep close to the existing manifest contract unless validation
  needs the field after generation

### 4. `--plan-only` Needs Precise Semantics

The plan proposes:

```bash
pnpm eval:validate --user samir-desai --corpus realistic --plan-only
```

This is the right idea, but it needs to be specified carefully because current
validation expects corpus fixtures and document paths.

Recommended semantics:

- `--plan-only` requires `corpus-plan.json`.
- It does not require `manifest.json`.
- It does not require document body files.
- It validates profile references, form references, plan schema, category
  counts, path safety, uniqueness, `factKeys[]`, `brief`, and planned
  distribution.
- It should still validate global templates and form maps as normal if that is
  cheap and consistent with current validator behavior.

Then normal validation, without `--plan-only`, requires the actual corpus
manifest and document body files.

### 5. Prose Checks Need A Conservative Severity Model

The plan has the right high-confidence list. I would be stricter about which
rules are errors on day one.

Good day-one hard errors:

- Declared email value missing from an extract/corroborate body.
- Declared SSN value missing, including digits-only variants.
- Declared USCIS/A-number missing.
- Declared exact postal code missing.
- Declared exact street address missing.
- Declared full legal name missing.
- Noise document contains email, SSN, USCIS/A-number, work email, or exact
  current street address.
- A document declares a null fact in `factKeys[]`.

Keep as warnings first:

- city/state detection
- first/last name fragments
- middle initials
- date variants
- undeclared profile values in prose
- boilerplate/repetition
- document thinness

For null facts, be careful with `DOCUMENT_MISSING_FACT_PRESENT`. If a fact is
`null`, there is no known value to search for. The rule must become
pattern-based for specific fact types, such as phone-number-like text when
`contact.phone` is intentionally missing.

### 6. Calibrating Against Elena Is Right, But It Should Not Freeze Progress

Using Elena's hand-authored 100-doc corpus for calibration is smart. However,
the plan should not require every new prose rule to pass Elena immediately as a
hard gate.

Recommended approach:

- high-confidence rules should pass Elena or expose real fixture drift
- fuzzy rules can emit warnings during calibration
- record warning counts in `validation-report.json`
- only promote a fuzzy rule after it has low false-positive rates on Elena and
  the Samir pilot

### 7. Preview Generation Should Be A First-Class Step

The plan mentions generating 5 preview files to `/private/tmp/samir-preview`.
That should be elevated into a checkpoint before committing to 100 documents.

Recommended preview acceptance criteria:

- 5 preview docs cover at least 3 categories.
- all pass high-confidence validation or have explainable warnings
- docs are not all structured the same way
- no current facts are invented
- noise docs avoid high-confidence identifiers
- stale/conflicting docs clearly signal stale/conflicting status

This gives a concrete go/no-go point before generating 100 files.

## Suggested Revision To The Checkpoints

I would revise the implementation checkpoints to:

### Checkpoint 1: Corpus Plan Contract

- Add `corpus-plan.schema.json`.
- Add `--plan-only`.
- Add plan distribution validation.
- Add tests.
- Do not add prose validation yet unless it stays small.

### Checkpoint 2: High-Confidence Prose Validation

- Add body reading and fact matcher.
- Add high-confidence errors only.
- Add fuzzy warnings.
- Calibrate on Elena and template-smoke.

### Checkpoint 3: Samir Pilot Plan And Preview Docs

- Add a small `realistic-pilot` or temp preview workflow.
- Generate 5-20 docs with Codex/Claude Code.
- Tune prompt contract and validation.

### Checkpoint 4: Full Samir Realistic Corpus

- Add full `corpus-plan.json`.
- Generate 100 docs in bounded agent batches.
- Commit docs, manifest, report.

### Checkpoint 5: Scenario And Snapshot

- Add `samir-desai-i9-realistic`.
- Generate and review `filled-form` snapshot.

### Checkpoint 6: Follow-Up Capture

- Update TODO with API generation, richer file types, command backend, and
  extraction-eval design.

Move the direct Vertex `eval:generate` implementation to a later optional
checkpoint or separate batch.

## Smaller Notes

- The plan says "one independent AI call per planned document." That is a good
  long-term target, but for the first interactive-agent workflow, a bounded
  request for 5-10 documents may be more ergonomic while still avoiding a
  single 100-doc session.
- The `realistic` corpus should omit `payroll-tax` for now. I agree with that.
- `partial-conflicting` count of 18 is reasonable, but the plan should define
  at least a few concrete challenge tags before generation starts:
  `stale-address`, `former-name`, `redacted-id`, `third-party-phone`,
  `employer-address-not-user-address`, `sample-id-ignore`.
- If `corpus-plan.json` becomes large, consider keeping it machine-readable but
  allowing comments only through adjacent markdown docs. JSON should stay
  strict so validation remains simple.
- `EVAL_GENERATION_MODEL` falling back to `VERTEX_MODEL_ID` is reasonable if
  Vertex generation is eventually added, but do not let fixture generation
  depend on backend product config semantics too tightly.

## Bottom Line

I agree with the implementation plan's goal and most of its fixture mechanics.
The plan correctly treats AI-generated prose as untrusted until validated.

My main disagreement is sequencing. I would not build direct Vertex generation
as part of the first implementation path. Build the plan contract, prose
validation, and a small coding-agent pilot first. Once those work, generating
the full 100-doc Samir corpus becomes much safer, and an API-backed generator
can be added as a convenience instead of a foundational dependency.
