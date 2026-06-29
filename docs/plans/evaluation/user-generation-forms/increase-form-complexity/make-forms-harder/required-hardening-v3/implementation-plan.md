# Required-Hardening V3 Implementation Plan

- Status: implemented and pending live review
- Last updated: 2026-06-29
- Scope: fixture-only `packet-hard-required-v3` corpus and scenarios

## Goal

Create a focused required-evidence packet that keeps v2 direct-deposit
difficulty and adds a second scored target: W-4 `tax.filingStatus`.

The intended v3 difficulty is not volume. It is evidence routing across
non-clean payroll-tax artifacts:

- direct deposit remains routed through the v2 `031` and `037` evidence chain;
- W-4 filing status is no longer available from clean tax docs `011`, `012`, or
  `013`;
- W-4 filing status must be resolved from doc `038`, which contains a current
  Maya fragment, an older Maya draft fragment, and a Noah worker-mismatch
  fragment.

## Checkpoints

1. Copy `packet-hard-required-v2` into `packet-hard-required-v3`.
2. Rename corpus/scenario ids, seed, descriptions, prompts, asset labels, and
   validation metadata to v3.
3. Rewrite docs `011`, `012`, and `013` so they keep W-4 shell/identity data but
   do not expose the exact current filing-status text.
4. Add doc `038`, a LedgerPay W-4 resolution audit with heterogeneous structure
   rather than another clean row-table reconciliation.
5. Update the manifest so `tax.filingStatus` is included only by doc `038`.
6. Extend Noah ownership metadata and audit rows for tax filing-status leakage.
7. Update Maya README, score tracking, and this implementation summary.
8. Validate the corpus and scenarios; run live direct/MCP comparisons later.

## Static Acceptance Checks

- `single or married filing separately` appears only in doc `038`.
- `head of household` appears only as stale/forbidden W-4 evidence in docs `034`
  and `038`.
- Manifest include mapping for `tax.filingStatus` points only at doc `038`.
- Manifest include mapping for `banking.institutionName` and
  `banking.accountType` still points only at doc `037`.
- Noah tax and banking decoys have ownership audit rows.
- No copied v2 corpus ids or seeds remain in the v3 corpus or scenarios.

## Validation Commands

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-required-v3 --write-report
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-required-v3
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-required-v3
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v3
node examples/eval/scripts/validate.mjs
```

## Live Review Plan

- Compare direct v2 and v3 with the same model.
- Run direct v3 with at least `canonical` and `relevant-last` document order.
- If those are clean, run 3-5 direct seeded-random v3 variants.
- Run MCP v3 once the backend and auth setup are available.
- Compare `knownFieldCorrect`, W-4 per-scenario score, direct-deposit
  per-scenario score, `memoryKnownRecovered`, wrong values, ownership leaks,
  stale leaks, and order-sensitive misses.

## Non-Goals

- Do not stack the 100-document hard-volume packet into v3.
- Do not change form maps, scorers, backend, MCP, runners, schema, or
  `profile.yaml`.
- Do not make documents cleaner just to improve baseline performance.
