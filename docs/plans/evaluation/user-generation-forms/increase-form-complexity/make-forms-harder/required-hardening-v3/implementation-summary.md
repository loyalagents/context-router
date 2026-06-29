# Required-Hardening V3 Implementation Summary

- Status: fixture implemented and validated; live review not run
- Last updated: 2026-06-29
- Scope: `packet-hard-required-v3` corpus, scenarios, and planning docs

## What Changed

- Added `examples/eval/users/maya-chen-newhire/corpora/packet-hard-required-v3`
  from `packet-hard-required-v2`.
- Added three v3 scenarios for I-9, FW-4, and direct deposit.
- Kept v2 direct-deposit and employment difficulty unchanged.
- Reworked W-4 evidence so scored `tax.filingStatus` requires resolving doc
  `038`, the LedgerPay W-4 resolution audit.
- Rewrote docs `011`, `012`, and `013` so they keep W-4 shell, identity, SSN,
  and address evidence where useful but no longer expose the current
  filing-status text.
- Removed exact filing-status answer labels from generic/sample W-4 docs in the
  v3 corpus so doc `038` is the only current answer source.
- Added Noah Kim tax filing-status metadata and ownership audit coverage.

## Evidence Routing

- `tax.filingStatus` is included only by
  `documents/payroll-tax/038-ledgerpay-w4-resolution-audit.yaml`.
- Doc `038` contains:
  - current Maya W-4 Step 1(c) fragment;
  - older Maya draft fragment using `head of household`;
  - Noah worker-mismatch fragment using a different filing status.
- `banking.institutionName` and `banking.accountType` remain included only by
  `documents/payroll-tax/037-ledgerpay-ach-prenote-reconciliation.yaml`.
- Employment title/start remain required through
  `documents/hr-onboarding/035-hr-support-correction-thread.txt`.

## Validation

Deterministic validation passed:

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-required-v3 --write-report
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-required-v3
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-required-v3
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v3
node examples/eval/scripts/validate.mjs
```

Results:

- v3 corpus/scenario validations: `errors=0 warnings=43`
- whole-tree validation: `errors=0 warnings=323`
- v3 validation report updated at
  `examples/eval/users/maya-chen-newhire/corpora/packet-hard-required-v3/validation-report.json`

Static evidence checks passed:

- `single or married filing separately` appears only in doc `038`.
- `head of household` appears only in docs `034` and `038`.
- Manifest include mapping for `tax.filingStatus` points only to doc `038`.
- Manifest include mapping for `banking.institutionName` and
  `banking.accountType` still points only to doc `037`.
- No copied v2 corpus ids remain in the v3 corpus or v3 scenarios.

## Live Review

Not run in this implementation pass. Recommended first runs:

```bash
pnpm eval:direct-open-schema-packet \
  --user maya-chen-newhire \
  --corpus packet-hard-required-v3 \
  --scenarios maya-chen-newhire-i9-packet-hard-required-v3,maya-chen-newhire-fw4-packet-hard-required-v3,maya-chen-newhire-direct-deposit-packet-hard-required-v3 \
  --artifacts-root /private/tmp/maya-required-v3-direct \
  --document-order canonical

pnpm eval:direct-open-schema-packet \
  --user maya-chen-newhire \
  --corpus packet-hard-required-v3 \
  --scenarios maya-chen-newhire-i9-packet-hard-required-v3,maya-chen-newhire-fw4-packet-hard-required-v3,maya-chen-newhire-direct-deposit-packet-hard-required-v3 \
  --artifacts-root /private/tmp/maya-required-v3-direct-relevant-last \
  --document-order relevant-last
```

Interpretation target:

- Best signal: W-4 filing-status checkbox wrong/missing or direct-deposit scored
  fields wrong/missing.
- Useful signal: memory stores stale/other-worker W-4 values even if form score
  remains intact.
- Failure signal: direct and MCP match v2 across canonical/order variants.
