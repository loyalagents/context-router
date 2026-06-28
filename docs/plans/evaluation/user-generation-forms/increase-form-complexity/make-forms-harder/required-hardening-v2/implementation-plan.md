# Required-Hardening V2 Implementation Plan

- Status: implemented and fixture-validated
- Last updated: 2026-06-28
- Scope: fixture-only `packet-hard-required-v2` corpus and scenarios

## Goal

Create a harder required-evidence packet that targets currently scored
direct-deposit form fields, not only memory recovery.

The first score-moving target is direct deposit institution/type:

- `banking.institutionName` should require resolving an ACH prenote
  reconciliation row;
- `banking.accountType` should require resolving the same selected row;
- old Redwood values and Noah Kim values remain plausible but inadmissible;
- v1's employment correction-thread difficulty remains unchanged.

## Checkpoints

1. Copy `packet-hard-required-v1` into `packet-hard-required-v2`.
2. Replace doc `031` so it no longer contains a clean current after-state with
   Bay Harbor/checking. It should identify Maya, the active deposit profile,
   the active successor token, the account ending, and the former Redwood row.
3. Add doc `037` as an ACH prenote reconciliation export with multiple rows:
   accepted current Maya row, former Redwood row, and Noah worker-mismatch row.
4. Update the manifest so `banking.institutionName` and
   `banking.accountType` are included only by doc `037`.
5. Add three v2 scenarios and update scenario prompts.
6. Update Maya's packet README and score tracking.
7. Validate the corpus and scenarios, then write an implementation summary.

## Static Acceptance Checks

- `Bay Harbor Credit Union`, `091000019`, `740182936451`, and `checking`
  appear only in intended hard evidence docs, with the current values in doc
  `037`.
- Manifest include mapping for `banking.institutionName` and
  `banking.accountType` points only at doc `037`.
- Redwood and Noah values appear only as stale/worker-mismatch decoys and are
  not included as Maya truth.
- No copied v1 corpus ids or seeds remain in the v2 corpus or scenarios.

## Validation Commands

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-required-v2 --write-report
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-required-v2
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-required-v2
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v2
node examples/eval/scripts/validate.mjs
```

## Non-Goals

- Do not change form maps, scorers, backend, MCP, runners, schema, or
  `profile.yaml`.
- Do not make the hard documents cleaner to improve baseline performance.
- Do not expand scoring in this PR.
