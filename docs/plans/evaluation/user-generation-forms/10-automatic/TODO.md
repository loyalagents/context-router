# 10-Automatic Eval Generation TODO

## Making Generated Documents More Realistic

- [x] Define a realism rubric before changing generation prompts.
  - Implemented through `sourceSpec` fields, artifact-world context, and
    warning-only realism lints for source metadata, native signals, length,
    stale cues, repeated skeletons, and eval-language leakage.

- [x] Improve corpus archetype briefs into richer source-document specs.
  - Replaced one-line briefs with V2 `sourceSpec` objects that describe source
    family, capture mode, native signals, safe/risky detail menus, world refs,
    timeline refs, and length targets.

- [x] Separate correctness requirements from realism requirements.
  - Deterministic corpus-truth validation remains the hard gate.
  - Realism checks are warning-only and reported without weakening correctness
    validation.

- [x] Add a realism review step after deterministic validation.
  - V2 emits a realism lint report inside `validation-report.json`.
  - Manual review is still required before promoting live Vertex-authored
    corpora.

- [x] Build better I-9 source-document families.
  - The I-9 planner now uses uploaded ID OCR, SSN OCR, status-aware work
    authorization support, resident portal lease export, utility JSON export,
    saved I-9 field export, offer email, onboarding YAML export, stale contact
    ticket, and newsletter/email noise.

- [ ] Add realism-focused repair later.
  - Keep the current repair loop focused on deterministic correctness.
  - Add a future repair mode that preserves validated facts while improving
    document genre, source voice, density, native signals, and incidental
    context.

- [ ] Add the document ingestion runner later.
  - Target flow: documents -> extracted facts -> scoring -> form-fill snapshot.
  - This remains out of scope for the V2 corpus-plan and generation batch.
