# 10-Document I-9 User Corpus Workflow Implementation Plan

## Summary

Implement a modular eval workflow for generating a reviewed-profile I-9 corpus:

1. scaffold and review `profile.yaml`
2. derive seed preferences
3. deterministically plan a 10-document corpus
4. generate preview documents with Vertex
5. validate and repair the preview
6. explicitly promote the passing preview into `examples/eval`
7. verify eval tooling

This work also prunes the old active 100-document realistic fixtures so the
active examples focus on the new smaller workflow.

## Implementation Steps

1. Prune large active fixtures and update tests/docs that referenced them.
2. Add deterministic I-9 corpus planning via `pnpm eval:plan-corpus`.
3. Extend `eval:validate` to support preview document roots and preview report output.
4. Add `pnpm eval:repair-generation` to regenerate only failed preview documents.
5. Add `pnpm eval:promote-preview` to copy a passing preview into the committed corpus.
6. Add targeted unit tests for planning, preview validation, repair, and promotion.
7. Run eval verification commands and write `implementation-summary.md`.

## Constraints

- Keep implementation under `examples/eval/scripts`; do not add backend runtime code.
- V1 supports I-9 only, but the planning structure should be extensible to other forms.
- Treat `profile.yaml` as reviewed canonical truth; do not generate profile facts in this pass.
- Preview generation may call Vertex, but promotion must not.
- Repair should consume document-scoped validation issues generically so future checks can feed the same loop.
