# Required-Hardening V4 Implementation Summary

- Status: fixture implemented, validated, and live-reviewed
- Last updated: 2026-06-29
- Scope: `packet-hard-required-v4` corpus, scenarios, and planning docs

## What Changed

- Added `examples/eval/users/maya-chen-newhire/corpora/packet-hard-required-v4`
  from `packet-hard-required-v3`.
- Added three v4 scenarios for I-9, FW-4, and direct deposit.
- Kept v3 employment, ownership, conflict, and expected-answer behavior.
- Reworked the scored direct-deposit institution/type path to require joining
  doc `037` keys through docs `039` and `040`.
- Reworked the scored W-4 filing-status path to require joining doc `038`
  choice codes through doc `041`.

## Evidence Routing

- `banking.institutionName` is included only by
  `documents/payroll-tax/039-ledgerpay-rdfi-directory-fragment.yaml`.
- `banking.accountType` is included only by
  `documents/payroll-tax/040-ledgerpay-account-class-catalog.yaml`.
- `tax.filingStatus` is included only by
  `documents/payroll-tax/041-federal-w4-choice-codebook.yaml`.
- Doc `037` still carries Maya's active direct-deposit row, routing number,
  account number, `rdfi_key`, and `account_class_code`.
- Doc `038` still carries Maya's selected W-4 choice code, stale Maya code, and
  Noah worker-mismatch code.

## Validation

Validation passed on 2026-06-29:

- `node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-required-v4 --write-report`
  passed with `errors=0 warnings=43`.
- `node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-required-v4`
  passed with `errors=0 warnings=43`.
- `node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-required-v4`
  passed with `errors=0 warnings=43`.
- `node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v4`
  passed with `errors=0 warnings=43`.
- `node examples/eval/scripts/validate.mjs` passed whole-tree validation with
  `errors=0 warnings=366`.

Static evidence checks passed:

- `Bay Harbor Credit Union` appears in doc `039`, not doc `037`.
- `checking` appears in doc `040`, not doc `037`.
- `single or married filing separately` appears in doc `041`, not doc `038`.
- Manifest include mapping for the three target facts points only to docs `039`,
  `040`, and `041`.

## Live Review

Live review used canonical document order only; v4 intentionally does not add
volume or order testing.

Artifact roots:

- `/private/tmp/maya-required-v3-direct-flash-lite-canonical`
- `/private/tmp/maya-required-v4-direct-flash-lite-canonical`
- `/private/tmp/maya-required-v3-direct-pro-canonical`
- `/private/tmp/maya-required-v4-direct-pro-canonical`
- `/private/tmp/maya-required-v4-mcp-canonical`

Summary:

| Run | Memory | Forms | Result |
| --- | --- | --- | --- |
| v3 direct `gemini-2.5-flash-lite` | `20/25` | `27/27` | Memory misses only; no scored form impact. |
| v4 direct `gemini-2.5-flash-lite` | `21/25` | `26/27` | Intended v4 score movement: direct deposit dropped to `8/9`. |
| v3 direct `gemini-2.5-pro` | `23/25` | `27/27` | Stronger direct model handled v3 scored fields. |
| v4 direct `gemini-2.5-pro` | `24/25` | `26/27` | Score moved through an I-9 citizenship normalization issue, not the intended banking/W-4 lookup. |
| v4 MCP Claude | `25/25` | `27/27` | MCP solved v4 fully. |

Detailed findings:

- Flash-lite v4 failed the intended multi-hop account-type target. It stored
  `payroll.direct_deposit.account_type = DDA` instead of resolving the class
  catalog value to `checking`. The direct-deposit form then missed
  `topmostSubform[0].Page1[0].xcheck[0]`.
- Pro v4 resolved the intended banking/W-4 lookup targets, including
  `checking`, `Bay Harbor Credit Union`, and
  `single or married filing separately`.
- Pro v4 still scored `26/27` because I-9 citizenship was represented as
  `person.citizenship.is_citizen = true` without an accepted
  `workAuthorization.citizenshipStatus = U.S. citizen` value. The raw fill
  response attempted to `CHECK` `CB_1`, but conditional validation treated the
  field as inactive because the canonical citizenship enum/string was missing.
- MCP Claude recovered all memory facts and filled all scored fields. No
  ownership leaks, wrong values, missing scored fields, or overfills were found.

Interpretation:

- V4 is a useful fixture because it moves direct form score without changing
  scorers, form maps, schemas, backend, MCP, or `profile.yaml`.
- The intended v4 difficulty currently affects flash-lite, not MCP Claude.
- The pro direct miss is a separate normalization/system interaction around
  boolean-vs-enum citizenship representation, not evidence that the v4
  banking/W-4 lookup path beat pro.
