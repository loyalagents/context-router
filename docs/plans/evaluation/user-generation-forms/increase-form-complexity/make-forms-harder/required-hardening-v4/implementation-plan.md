# Required-Hardening V4 Implementation Plan

- Status: implemented and pending validation
- Last updated: 2026-06-29
- Scope: fixture-only `packet-hard-required-v4` corpus and scenarios

## Goal

Create a focused multi-hop packet that keeps v3's expected answers and scoring
surface, but removes clean literal answer rows for three already-scored fields:

- `banking.institutionName`
- `banking.accountType`
- `tax.filingStatus`

The intended v4 difficulty is code and directory resolution, not volume or
document ordering.

## Checkpoints

1. Copy `packet-hard-required-v3` into `packet-hard-required-v4`.
2. Rename corpus/scenario ids, seeds, descriptions, prompts, asset labels, and
   validation metadata to v4.
3. Rewrite direct-deposit doc `037` so it exposes active Maya row keys,
   routing/account numbers, `rdfi_key`, and `account_class_code`, but not the
   literal current bank name or account type label.
4. Add doc `039`, the RDFI directory lookup for `banking.institutionName`.
5. Add doc `040`, the account class lookup for `banking.accountType`.
6. Rewrite W-4 doc `038` so it exposes only choice codes and selected fragment
   metadata, not literal filing-status labels.
7. Add doc `041`, the W-4 choice-code lookup for `tax.filingStatus`.
8. Update Maya README, score tracking, and implementation summary.
9. Validate the corpus and scenarios; run live direct/MCP comparisons later.

## Static Acceptance Checks

- `Bay Harbor Credit Union` appears in doc `039`, not doc `037`.
- `checking` appears in doc `040`, not doc `037`.
- `single or married filing separately` appears in doc `041`, not doc `038`.
- Manifest include mapping points:
  - `banking.institutionName` only to doc `039`;
  - `banking.accountType` only to doc `040`;
  - `tax.filingStatus` only to doc `041`.
- Noah banking and tax decoys remain covered by ownership audit rows.
- No copied v3 corpus ids or seeds remain in v4 corpus or scenarios.

## Validation Commands

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-required-v4 --write-report
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-required-v4
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-required-v4
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v4
node examples/eval/scripts/validate.mjs
```

## Live Review Plan

- Run canonical direct v3 vs v4 with `gemini-2.5-flash-lite`.
- Run canonical direct v3 vs v4 with `gemini-2.5-pro`.
- Run canonical MCP Claude v4.
- Compare `knownFieldCorrect`, W-4 score, direct-deposit score,
  `memoryKnownRecovered`, wrong values, stale leaks, and Noah ownership leaks.

## Non-Goals

- Do not change form maps, scorers, backend, MCP, schemas, runners, or
  `profile.yaml`.
- Do not score routing/account digit boxes in this PR.
- Do not add volume noise or document-order testing in this PR.
- Do not add a new employment-scored form surface in this PR.
