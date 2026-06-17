# Review: Direct Vertex Open-Schema Baseline (commit 3b041ab)

- Reviewer pass: 1
- Scope: `3b041ab` cherry-pick, compared against `main`
- Verification run: `node --test direct-open-schema.test.mjs open-schema-database.test.mjs open-schema-combined.test.mjs score.test.mjs` → 20/20 pass

## Overall recommendation

**Ship with fixes.** The feature is well-scoped and the leakage boundary is clean.
The two things worth resolving before merge are (1) the all-or-nothing
extraction gate that can abort the headline metric on a single model slip, and
(2) the global loosening of `backendUserId` in the shared memory-snapshot
schema. Neither is a correctness defect in the happy path; both are
risk/contract decisions worth an explicit call.

---

## 1. Findings by severity

### High

**H1 — A single malformed fact aborts the entire run before form fill.**
`validateExtractionPayload` (`direct-open-schema.mjs:580`) returns `ok:false`
whenever `validationDiagnostics.length > 0`, and `normalizeExtractedFact` /
`normalizeEvidence` push a diagnostic for *any* per-fact problem: a hallucinated
`documentId` not in the corpus (`:884`), a `confidence` outside `[0,1]`
(`:844`), a `valueType` typo (`:832`), etc. One bad row in an otherwise-good
20-fact response makes the run exit 1 with no `filled-form.json` and no
`form-score-report.json`.

This conflicts with the stated goal that **final form correctness is the
headline metric** and with the "preserve mistakes, do not repair" principle:
the current behavior neither preserves the mistake nor scores the form — it
throws the whole evaluation away. Hallucinated `documentId`s and out-of-range
confidence are exactly the kind of model error a baseline should *measure*, not
hard-fail on. Consider dropping invalid facts (recording them in
`validationDiagnostics`/extraction-response) and proceeding when at least the
structural envelope is valid, reserving hard failure for non-array `facts` /
non-object payloads.

### Medium

**M1 — `backendUserId` nullability is loosened globally in the shared schema.**
`memory-snapshot.schema.json` changed `backendUserId` from a required non-empty
string to `["string","null"]` (diff lines ~124). This schema is shared with the
real backend memory exports, which should always carry a real user id. The
change silently weakens validation for *every* snapshot, not just synthetic
ones. The enum additions (`synthetic-no-backend`,
`SyntheticDirectOpenSchemaSnapshot`) are additive and safe, but the nullability
relaxation is the one change that reduces coverage on the existing path.
Consider whether a conditional (synthetic queryName ⇒ nullable; otherwise
required) is worth the complexity, or at minimum document the trade-off.

**M2 — Stage 2 ships `inferredDataKey`; Stage 1 deliberately strips it.**
`buildExtractionFieldContext` (`:798`) intentionally omits `inferredDataKey`
(test asserts its absence at `:93`), but `buildFactOnlyFillPrompt` serializes
the *full* `fieldMetadata` (`:513`), which includes `inferredDataKey`. The
asymmetry is defensible — slugs are authored only in Stage 1 (which never sees
the key), so the diagnostic slug score can't be contaminated, and this matches
the existing `buildDirectFormFillPrompt` baseline — but it's worth an explicit
confirmation that `inferredDataKey` is *not* considered field-map answer
leakage. If it is, Stage 2 needs the same projection Stage 1 uses.

### Low / Minor

**L1 — Synthetic `definition.valueType` vocabulary may diverge from backend.**
`syntheticDefinitionForFact` (`:1162`) sets `valueType` to the extraction
vocabulary (`STRING|BOOLEAN|ENUM|ARRAY`). Real definitions may use a different
vocabulary. The shared schema only requires a non-empty string and the
open-schema scorers match on value, not valueType, so this is harmless today —
but confirm no downstream consumer keys off `valueType`.

**L2 — Late, expensive failure for missing model.** `runDirectOpenSchema`
throws "Set EVAL_DIRECT_OPEN_SCHEMA_MODEL or pass --model" (`:91`) only after
running scenario validation, loading the fixture, and reading the entire
evidence corpus. `parseArgs` already knows the model is absent; failing there
(usage-error) is cheaper and clearer. Minor: model resolution is duplicated
between `parseArgs` (`:339`) and `runDirectOpenSchema` (`:90`).

**L3 — `fieldPolicy.branchValues` reaches Stage 1.** Via `promptFieldPolicy`
(`fill-form-from-docs.mjs:398`), conditional branch values derived from
`fieldMap.when` are included in the safe form context. This is reused verbatim
from the existing direct baseline (form-structure logic, not the answer key),
so it is not a new leak — noting it only so the "safe form context" boundary is
understood to include form branching values by design.

---

## 2. Confirmed-clean / strengths

- **Prompt leakage is clean.** Neither prompt path loads `profile.yaml` facts,
  the storage/accepted-slug map, validation reports, DB/stored-preference
  exports, score reports, or prior baseline outputs. Stage 1 sees only the
  scenario prompt, projected field context, and declared corpus docs; Stage 2
  sees only model-authored facts + field metadata, and explicitly not the raw
  documents (test `:124`).
- **Stage separation is clean.** Stage 2 receives extraction output only; no
  document content crosses over.
- **Synthetic snapshot preserves mistakes.** Duplicate slugs become separate
  definitions/preferences (`:732`, test `:354`), values/evidence/confidence are
  copied through unmodified, IDs are deterministic hashes (`:1187`), and no
  slug/value/dedup normalization occurs.
- **Artifact contracts are sensible.** `open-schema-extraction-response.json` is
  always written (incl. malformed JSON) and `open-schema-extraction.json` only
  on validate — matches the documented contract.
- **Known-schema artifacts/scorers untouched.** Diff touches only the new files,
  `memory-snapshot.schema.json`, and `package.json`. No known-schema scorer
  changes.
- **`--skip-extraction-scoring` correctly gates** the synthetic snapshot + PR2
  diagnostics (test `:294`).

---

## 3. Open questions / assumptions

1. Is the all-or-nothing extraction gate (H1) intentional strictness, or should
   invalid facts be dropped so the headline form score still gets produced?
2. Is the global `backendUserId` nullability (M1) acceptable, or should it be
   scoped to synthetic snapshots?
3. Is `inferredDataKey` in the Stage 2 prompt (M2) considered acceptable
   (form-mapping hint) or a field-map answer leak?
4. Does any scorer/consumer depend on `definition.valueType` vocabulary (L1)?
5. `fixture.prompt` is passed to Stage 1 verbatim — assumed to contain only the
   task instruction and no expected answers. Worth a one-line confirmation since
   it's the one free-text fixture field in the prompt.

---

## 4. Suggested fixes / follow-up checkpoints

- **Checkpoint A (H1):** Change extraction validation to drop-and-record invalid
  facts; hard-fail only on structural envelope errors. Add an e2e test: a
  response with one hallucinated `documentId` still produces
  `form-score-report.json` and records the dropped fact in the response
  artifact.
- **Checkpoint B (M1):** Decide schema scoping for `backendUserId`; if kept
  global, note the rationale in `implementation-summary.md`.
- **Test gaps to close:**
  - End-to-end malformed-JSON path: `open-schema-extraction-response.json`
    written, exit 1, no `filled-form.json` (currently only unit-level coverage
    of `validateExtractionPayload`).
  - Fill-stage failure path: `direct-open-schema-fill-response.json` written and
    exit 1 when `validateFactFillActions` fails.
  - Assert an actual fixture truth value (e.g., the expected SSN string) is
    absent from the Stage 1 prompt — current tests check key *names*
    (`factKey`, `expectedValue`) but not leaked *values*.
  - Synthetic snapshot preserves a *wrong* model value unchanged (companion to
    the duplicate-slug test).
- **Minor:** Fail fast on missing model in `parseArgs` (L2).
