# MCP Scoring Follow-Up Implementation Plan

- Status: implemented
- Last updated: 2026-06-16

## Summary

Document the current MCP known-schema runner as an existing-schema/product-style
eval, then harden backend form-fill prompting around field policies without
changing validator enforcement. Off-policy form-fill source choices should
remain visible and scored as real backend form-fill failures.

## Implementation Steps

1. Add this plan doc as the docs-first checkpoint.
2. Clarify MCP known-schema terminology in the MCP scoring docs:
   - `--schema-mode known` means the agent can use existing visible backend
     schema.
   - It is not a closed target-form-only schema.
   - The backend known-schema ingestor and MCP known-schema runner are
     intentionally different producers.
   - The first live MCP smoke is a readiness signal for open schema, not an
     apples-to-apples closed-schema benchmark.
3. Harden `FormFillPromptBuilderService` instructions:
   - Field policies are authoritative when present.
   - For `mode=fact`, use only active memories whose slugs are listed in the
     field policy `sourceSlugs`.
   - If no allowed source slug has a usable value, return `SKIP`.
   - Do not substitute semantically similar memories, such as work email for
     contact email.
4. Update tests:
   - Prompt tests assert authoritative field-policy wording.
   - Prompt tests assert no semantically similar substitutions.
   - Existing validator tests continue to assert diagnostic-only
     `policy_source_slug_off_policy` behavior.
5. Run targeted tests and broad eval verification.
6. Add `implementation-summary.md`.
7. Update scoring trackers:
   - `docs/plans/evaluation/scoring/TODO.md`
   - `docs/plans/evaluation/scoring/orchestration.md`
   - `docs/plans/evaluation/scoring/MCP-scoring/orchestration.md` if status or
     live-smoke notes need follow-up context.

## Test Plan

```bash
pnpm --filter backend exec jest src/modules/preferences/form-fill --runInBand
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:verify
```

Optional live smoke after backend and Claude MCP auth are available:

```bash
pnpm eval:e2e-mcp-agent \
  --agent claude \
  --schema-mode known \
  --form-mode backend \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --artifacts-root /private/tmp/alex-mcp-known-schema-follow-up \
  --mcp-server context-router-local \
  --mcp-config /private/tmp/context-router-mcp.json \
  --reset-memory
```

## Assumptions

- The MCP runner gating follow-up is already implemented.
- This follow-up does not add a separate closed-schema MCP mode.
- This follow-up does not hard-block off-policy source slugs.
- Tracker updates use the existing scoring tracker paths.
