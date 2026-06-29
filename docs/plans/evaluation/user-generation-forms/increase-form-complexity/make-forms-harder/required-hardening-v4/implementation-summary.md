# Required-Hardening V4 Implementation Summary

- Status: fixture implemented and validated; live review not run
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

Not run in this implementation pass. Use canonical order first; v4 intentionally
does not add volume or order testing.
