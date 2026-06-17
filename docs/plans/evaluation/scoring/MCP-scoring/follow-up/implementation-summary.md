# MCP Scoring Follow-Up Implementation Summary

- Status: implemented
- Last updated: 2026-06-16

## Summary

This follow-up clarified the current MCP known-schema runner as an
existing-schema/product-style eval and hardened backend form-fill prompting
around field policies.

`--schema-mode known` now remains documented as "use the visible backend schema
that already exists." It is not a closed target-form-only schema, and it is not
an apples-to-apples benchmark against the backend known-schema document ingestor.
The live MCP smoke is still useful before open-schema work because it exercises
agent document reading, MCP memory writes, export, scoring, and backend form
fill end to end.

## Changes

- Updated MCP scoring docs to call out that backend known-schema ingestion and
  MCP known-schema agent runs are intentionally different producers.
- Hardened `FormFillPromptBuilderService` instructions:
  - field policies are authoritative when present;
  - `mode=fact` fields may use only active memories listed in policy
    `sourceSlugs`;
  - fields should be skipped when no allowed source slug has a usable value;
  - semantically similar memories must not be substituted, including work email
    for contact or personal email unless explicitly allowed.
- Kept off-policy source slug validation diagnostic-only. The eval still sees
  and scores backend form-fill mistakes truthfully instead of masking them.
- Added prompt-builder assertions for the new authoritative policy and
  no-substitution wording.

## Verification

```bash
pnpm --filter backend exec jest src/modules/preferences/form-fill --runInBand
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:verify
```

All commands passed locally on 2026-06-16.

## Remaining Work

- Run another optional live MCP smoke after backend and Claude MCP auth are
  available if a post-follow-up artifact comparison is useful.
- Continue with open-schema memory snapshot/scoring and MCP open-schema mode.
