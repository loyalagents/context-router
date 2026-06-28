# Required-Hardening V2 Implementation Summary

- Status: fixture implemented, validated, and live-reviewed
- Last updated: 2026-06-28
- Scope: `packet-hard-required-v2` corpus, scenarios, and planning docs

## What Changed

- Added `examples/eval/users/maya-chen-newhire/corpora/packet-hard-required-v2`
  from `packet-hard-required-v1`.
- Added three v2 scenarios for I-9, FW-4, and direct deposit.
- Kept v1's employment correction-thread difficulty unchanged.
- Reworked direct-deposit evidence so current scored institution/type require
  resolving doc `037`, the ACH prenote reconciliation export.
- Reworked doc `031` into an audit/pointer document: it identifies Maya, the
  active deposit profile, active token, account ending, and former Redwood row,
  but does not expose a clean current Bay Harbor/checking after-state.
- Preserved stale Redwood and Noah Kim worker-mismatch rows as hard decoys.
- Removed exact `checking` answer tokens from generic/sample/noise docs in the
  v2 corpus so the current account type is only available in doc `037`'s
  accepted candidate row.

## Evidence Routing

- `banking.institutionName` and `banking.accountType` are included only by
  `documents/payroll-tax/037-ledgerpay-ach-prenote-reconciliation.yaml`.
- `banking.routingNumber` and `banking.accountNumber` are also included by doc
  `037` in v2.
- Doc `031` includes only `banking.accountHolderName`; it provides the profile
  pointer and former Redwood conflict evidence.
- Employment title/start remain required through
  `documents/hr-onboarding/035-hr-support-correction-thread.txt`.

## Validation

Deterministic validation passed:

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-required-v2 --write-report
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-required-v2
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-required-v2
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v2
node examples/eval/scripts/validate.mjs
```

Results:

- v2 corpus/scenario validations: `errors=0`, `warnings=42`
- whole-tree validation: `errors=0`, `warnings=234`
- v2 validation report updated at
  `examples/eval/users/maya-chen-newhire/corpora/packet-hard-required-v2/validation-report.json`

Static evidence checks passed:

- `Bay Harbor Credit Union`, `091000019`, `740182936451`, and exact
  `checking` occur only in doc `037`'s accepted candidate row.
- Manifest include mapping for `banking.institutionName` and
  `banking.accountType` points only to doc `037`.
- No copied v1 corpus ids remain in the v2 corpus or v2 scenarios.

## Live Review

Reviewed live runs on 2026-06-28:

| Run | Result | Notes |
| --- | --- | --- |
| Direct baseline | `memory=21/25`, `fields=26/27`, direct deposit `8/9` | V2 moved score. Direct-deposit institution was wrong: expected `Bay Harbor Credit Union`, got employer name `Pacific Ledger Cooperative`. |
| Direct `gemini-2.5-pro` | `memory=24/25`, `fields=27/27`, direct deposit `9/9` | Stronger direct extraction recovered the scored banking fields. The only memory miss was `banking.accountHolderName`; this did not affect form score because the account title was filled from Maya identity/name facts. |
| MCP Claude | `memory=25/25`, `fields=27/27`, direct deposit `9/9` | MCP handled the evidence path and kept ownership clean. An earlier MCP attempt failed before scoring due to backend form-fill structured output returning `value: null`; that was a backend robustness issue, not a packet difficulty result. |

Interpretation:

- V2 is a real improvement over v1 because it can move scored direct-deposit
  form quality when the direct extractor does not resolve the reconciliation
  evidence.
- V2 does not reliably move form score for stronger models. `gemini-2.5-pro`
  and MCP Claude both resolved the hard direct-deposit institution/type evidence.
- `banking.accountHolderName` is not a strong difficulty target because the
  expected value is the user's legal name and can be recovered from identity
  facts even when the direct-deposit-specific memory fact is absent.
- No reviewed v2 run showed ownership leakage from Noah Kim or stale Redwood
  values into active scored facts.
