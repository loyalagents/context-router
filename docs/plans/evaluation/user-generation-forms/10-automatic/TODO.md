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

- [x] Collapse realistic planning into a unified V2 manifest.
  - `manifest.json` is now the canonical V2 contract for both planning and
    validation.
  - `corpus-plan.json` is retired from realistic generation and validation.
  - `template-smoke` manifests use the same `factContract` and
    `evaluationRole` shape without fake `sourceSpec` metadata.

- [x] Harden deterministic work-authorization validation.
  - Declared work-authorization expiration, I-94 admission number, and foreign
    passport number facts are now deterministic high-confidence checks.
  - Alex's realistic corpus validates with zero unsupported declared facts.

- [x] Reduce realism lint noise and add contradiction warnings.
  - Native-signal matching now normalizes camelCase, snake_case, kebab-case,
    spaced labels, and slash labels.
  - Warning-only I-9 contradiction lints flag undeclared USCIS, I-94, foreign
    passport, and work-authorization expiration values in current extract
    sources.

- [x] De-narrate missing-value generation prompts.
  - Generation prompts pass absent person-detail paths without source-facing
    reason text, and instruct generated artifacts to omit absent values unless
    the source naturally has a blank/null field.

- [ ] Add deterministic nested field/value proof for generated structured exports.
  - Current split legal-name proof handles same-line labels such as
    `s1_first_name: Alex` and OCR labels such as `FN ALEX JORDAN`, but does not
    yet prove `identity.legalName` from nested YAML records like
    `first_name: { field_id: s1_first_name, value: Alex }`.
  - Extend this carefully for native I-9 field/value exports, including nested
    I-94/USCIS/passport values, so validator warnings do not misclassify these
    identifiers as source-only phone values.

- [ ] Add realism-focused repair later.
  - Keep the current repair loop focused on deterministic correctness.
  - Add a future repair mode that preserves validated facts while improving
    document genre, source voice, density, native signals, and incidental
    context.

- [ ] Add the document ingestion runner later.
  - Target flow: documents -> extracted facts -> scoring -> form-fill snapshot.
  - This remains out of scope for the V2 unified-manifest generation batch.
