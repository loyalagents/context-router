# Review Feedback A

Reviewed commit `3b041ab` on `codex/plan-vertex-baseline` against `main`.

## Findings

1. High: field-map notes leak fixture truth into both Vertex prompts.

   `buildPromptFieldMetadata()` includes `fieldPolicy: promptFieldPolicy(fieldMap)` and `promptFieldPolicy()` copies `fieldMap.note` into prompt-visible policy data (`examples/eval/scripts/fill-form-from-docs.mjs:330`, `examples/eval/scripts/fill-form-from-docs.mjs:388`). The direct baseline then sends that policy in Stage 1 safe form context (`examples/eval/scripts/direct-open-schema.mjs:470`, `examples/eval/scripts/direct-open-schema.mjs:798`) and Stage 2 full field metadata (`examples/eval/scripts/direct-open-schema.mjs:512`). The committed I-9 map contains a note saying `Elena declares this fact as null in profile.yaml; the corpus manifest marks it intentionally missing` (`examples/eval/forms/i-9/field-map.json:146`). That exposes profile truth and intentionally-missing fixture metadata to Vertex, violating the explicit no-leak boundary. The current prompt test checks some forbidden strings but misses `profile.yaml`, `intentionally missing`, `declares`, and scenario/user-specific note text (`examples/eval/scripts/direct-open-schema.test.mjs:72`).

2. Medium: model slugs and evidence are lightly repaired before scoring.

   Extraction validation uses `stringField()` for `slug`, `label`, `documentId`, and `quote` (`examples/eval/scripts/direct-open-schema.mjs:827`, `examples/eval/scripts/direct-open-schema.mjs:881`, `examples/eval/scripts/direct-open-schema.mjs:1191`). Because `stringField()` trims, a model slug like `"profile.full_name "` becomes `"profile.full_name"` before `open-schema-extraction.json` and `synthetic-memory-snapshot.json` are written. That can improve accepted-slug diagnostic scoring and contradicts the "preserve model mistakes / no slug cleanup" requirement. Values are preserved, but slugs and evidence strings are not exact.

3. Medium: synthetic `memory-snapshot.schema.json` allowances are not scoped to synthetic snapshots.

   The schema now globally accepts `definitionBaseline.strategy: "synthetic-no-backend"` (`examples/eval/schemas/memory-snapshot.schema.json:73`), `diagnostics.queryName: "SyntheticDirectOpenSchemaSnapshot"` (`examples/eval/schemas/memory-snapshot.schema.json:111`), nullable `diagnostics.backendUserId` (`examples/eval/schemas/memory-snapshot.schema.json:124`), and `diagnostics.schemaResetMode: "synthetic-no-backend"` (`examples/eval/schemas/memory-snapshot.schema.json:126`). That is minimal in size but broad in effect: a backend/MCP memory snapshot could now validate with a null backend user or synthetic labels. Known-schema artifacts/scorers are not directly changed, but this weakens shared validation.

4. Low: response artifact contracts are looser than the rest of the baseline.

   `open-schema-extraction.json`, `filled-form.json`, synthetic memory snapshots, and PR2 reports are schema-validated. `open-schema-extraction-response.json` and `direct-open-schema-fill-response.json` are written from local builders without schemas (`examples/eval/scripts/direct-open-schema.mjs:934`, `examples/eval/scripts/direct-open-schema.mjs:965`). That is probably fine for raw diagnostic dumps, but it means these artifacts do not have the same durable contract as the scored artifacts. The fill response can also contain raw non-`SKIP` model actions with invalid `sourceFactIds`; the evaluator drops them from actual PDF filling, but the response artifact itself has no schema-level provenance contract.

## Open Questions / Assumptions

- I treated `fieldPolicy.branchValues` and render hints as safe form policy, not fixture truth. If branch values are considered field-map answers, those should be removed too.
- Stage 2 currently sees `inferredDataKey` because it sends full `fieldMetadata`; Stage 1 strips it. I assumed this generated PDF hint is acceptable for fill, but the plan language around "generated data-key hints" may need a clear yes/no.
- Scenario prompts still mention backend/seeded memory. I do not see data leakage there, but it is semantically noisy for a no-storage baseline.

## Suggested Fixes / Checkpoints

1. Add a direct-baseline-specific safe field metadata builder. Whitelist only PDF field name/type, inferred label, fill policy, options, skip action/reason, render hint, and any approved branch policy. Drop `note` entirely unless notes get a separate safe-note review.
2. Add prompt-boundary tests across all current scenarios/forms that reject `profile.yaml`, `seedPreferences`, `factKey`, `intentionally missing`, `declares`, validation-report names, field-map paths, accepted slug terms, previous artifact names, and known user-specific field-map note text.
3. Preserve model-authored slug/evidence strings exactly, or reject malformed strings without normalizing them. Add a regression where a trailing-space accepted slug does not become an accepted-slug recovery.
4. Scope synthetic memory-snapshot schema allowances with `oneOf`/`if-then`: direct synthetic snapshots may have null backend user and synthetic labels; backend/MCP snapshots must keep `EvalMemorySnapshotExport`, non-null `backendUserId`, and non-synthetic reset modes.
5. Consider lightweight schemas for `open-schema-extraction-response.json` and `direct-open-schema-fill-response.json`, or explicitly document them as unstable raw diagnostics.

## Verification

- `node --test examples/eval/scripts/direct-open-schema.test.mjs examples/eval/scripts/scoring/open-schema-database.test.mjs examples/eval/scripts/scoring/open-schema-combined.test.mjs examples/eval/scripts/score.test.mjs` passed: 20/20.
- `pnpm eval:verify` passed: 292/292 eval tests, validation passed with the existing 11 Alex warnings and no errors.

## Recommendation

Ship with fixes. The architecture is close and known-schema scorer stability looks good, but the field-map note leak means this commit should not be treated as benchmark-valid until prompt sanitization is fixed.
