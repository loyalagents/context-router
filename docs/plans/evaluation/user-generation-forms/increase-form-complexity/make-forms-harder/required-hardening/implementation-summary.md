# Required-Hardening Implementation Summary

- Status: implemented and validated
- Last updated: 2026-06-28
- Scope: fixture-only `packet-hard-required-v1` corpus and scenarios

## What Changed

Added:

- `examples/eval/users/maya-chen-newhire/corpora/packet-hard-required-v1/`
- `maya-chen-newhire-i9-packet-hard-required-v1`
- `maya-chen-newhire-fw4-packet-hard-required-v1`
- `maya-chen-newhire-direct-deposit-packet-hard-required-v1`
- Maya packet README

The new corpus starts from `packet-hard-conflict-v1`, preserves conflict docs
`031`-`035`, and adds one ownership decoy payment-election export as doc `036`.

## Required Evidence Paths

Banking:

- removed clean proof docs `016`, `017`, and `018`;
- kept doc `031` as the only manifest include source for
  `banking.accountHolderName`, `banking.institutionName`,
  `banking.accountType`, `banking.routingNumber`, and
  `banking.accountNumber`;
- added Noah Kim's payment-election export as an ownership decoy with
  `ownershipAudit` rows for his bank values.

Employment:

- removed exact current title/start values from docs `006`, `008`, `009`,
  `010`, and `022`;
- removed `employment.title` and `employment.startDate` from those docs'
  `factContract.include` arrays;
- kept doc `035` as the only manifest include source for `employment.title`
  and `employment.startDate`.

No backend, MCP, scorer, runner, form-map, schema, or `profile.yaml` changes
were made.

## Static Checks

Document-body search:

```text
Bay Harbor Credit Union -> doc 031 only
091000019               -> doc 031 only
740182936451            -> doc 031 only
Client Operations Associate -> doc 035 only
2026-07-06              -> doc 035 only
```

Manifest include mapping:

```text
banking facts          -> doc 031 only
employment title/start -> doc 035 only
```

No stale copied `packet-hard-conflict-v1` corpus ids or seeds remain in the new
corpus or scenarios.

## Validation

Used the underlying validation script directly because the `pnpm` wrapper tried
to run an install/dependency-status check in a non-TTY shell.

Commands run:

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-required-v1 --write-report
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-required-v1
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-required-v1
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v1
node examples/eval/scripts/validate.mjs
```

Results:

```text
focused corpus validation: 0 errors, 41 warnings
scenario validations:      0 errors, 41 warnings each
whole-tree validation:     0 errors, 192 warnings
```

The focused warning count is lower than `packet-hard-conflict-v1` because the
three clean banking proof documents were removed. Remaining warnings are the
same categories already present in the inherited packet family: source length,
missing native signals, phone-like source text while `contact.phone` is
intentionally missing, and one `.txt` Markdown-style warning.

## Next Live Run

Compare `packet-hard-required-v1` against `packet-medium` and
`packet-hard-conflict-v1` for:

- recovery of current banking values from the deposit audit;
- recovery of current employment title/start from the correction thread;
- stale bank and draft employment leakage;
- Noah Kim ownership leakage;
- differences between direct no-memory and stored-memory MCP paths.
