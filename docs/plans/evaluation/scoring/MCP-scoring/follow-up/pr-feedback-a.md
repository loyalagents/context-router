# MCP Scoring Follow-Up Review A

- Review target: `023835e` (`Harden MCP form-fill policies and update scoring docs`)
- Scope reviewed: follow-up plan/summary docs, commit diff, backend form-fill prompt/validator changes, MCP scoring tracker updates, and targeted/full eval verification.

## Summary

No blocking issues found.

The change is aligned with the stated direction: it clarifies that MCP
`--schema-mode known` is an existing-visible-schema product-style eval, not a
closed target-form-only benchmark, and it hardens the backend form-fill prompt
without changing the truthful scoring behavior. Keeping off-policy source slug
validation diagnostic-only is consistent with the goal of letting evals expose
real backend form-fill mistakes.

## Findings

### 1. Minor doc wording overstates enforcement

Severity: low

Two tracker bullets say semantically similar substitutions are "rejected":

- `docs/plans/evaluation/scoring/TODO.md:85`
- `docs/plans/evaluation/scoring/MCP-scoring/orchestration.md:40`

The implementation does not reject these substitutions in code. It instructs
the model not to make them in `FormFillPromptBuilderService`, while the
validator still records `policy_source_slug_off_policy` as a diagnostic event
and allows the fill:

- `apps/backend/src/modules/preferences/form-fill/form-fill-prompt-builder.service.ts:26`
- `apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts:221`

That behavior is intentional and, in my view, correct for evaluation truth. The
word "rejected" is the only mismatch. I would change those bullets to something
like "instructs the model not to make semantically similar substitutions" or
"discourages semantically similar substitutions while scoring any remaining
mistakes."

## Residual Risks

The prompt hardening is still advisory. `FormFillService` continues to pass all
active memories into the prompt, not a per-field candidate set:

- `apps/backend/src/modules/preferences/form-fill/form-fill.service.ts:81`

That is acceptable for this follow-up because the goal was prompt hardening
without masking eval failures. It does mean the only way to know whether the
email failure is fixed is another live form-fill/MCP smoke. The tests confirm
the prompt text and validator contract, but they do not prove the model will
stop choosing off-policy but semantically close memories.

I agree with deferring any stronger candidate-filtering or hard enforcement
until after open-schema work exposes more real failure patterns. The current
behavior preserves truth: if the backend still picks the wrong source, the form
score will still show it.

## What Looks Good

- The known-schema terminology cleanup is important and accurate. The MCP agent
can see existing visible schema, including non-target-form definitions, so it is
not comparable to the backend known-schema ingestor as a closed-schema producer.
- The prompt wording is generic enough for non-I-9 forms. The email example is
specific, but it is framed as an example of same-type substitution rather than
an I-9-specific rule.
- The validator test rename is useful because it makes the diagnostic-only
off-policy behavior explicit.
- The docs correctly preserve the distinction between improving backend
instructions and keeping evaluation scores honest.

## Verification

Passed locally during review:

```bash
pnpm --filter backend exec jest src/modules/preferences/form-fill --runInBand
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:verify
```

`pnpm eval:validate` still reports the existing 11 Alex realistic fixture
warnings and 0 errors.
