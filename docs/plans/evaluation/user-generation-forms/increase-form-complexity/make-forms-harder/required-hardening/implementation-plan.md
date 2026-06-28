# Required-Hardening Implementation Plan

- Status: implemented and validated
- Last updated: 2026-06-28
- Scope: fixture-only `packet-hard-required-v1` corpus and scenarios

## Goal

Create a combined ownership/conflict packet that is harder for a useful reason:
some required form facts should not be recoverable by ignoring the new hard
documents.

The first required-hard scope is direct deposit plus employment:

- current banking facts must come from the LedgerPay before/after deposit audit;
- current employment title and start date must come from the HR correction
  thread;
- the Noah Kim payment election must remain a current-looking non-Maya
  ownership decoy;
- Maya truth in `profile.yaml` stays unchanged.

## Checkpoints

1. Copy `packet-hard-conflict-v1` into `packet-hard-required-v1` so existing
   conflict docs `031`-`035` are preserved.
2. Remove clean banking proof docs `016`, `017`, and `018` from the new corpus
   and manifest.
3. Add Noah Kim's payment-election export as a new ownership decoy doc with
   `ownershipAudit` rows for the banking values.
4. Remove exact current employment title/start values from clean docs `006`,
   `008`, `009`, `010`, and `022`, and remove those keys from their
   `factContract.include` arrays.
5. Keep doc `031` as the only include source for current banking facts and doc
   `035` as the only include source for `employment.title` and
   `employment.startDate`.
6. Add three scenarios pointing at `packet-hard-required-v1`.
7. Update planning docs and Maya's packet README.
8. Validate the corpus and scenarios, then write an implementation summary with
   warning counts and static evidence-check results.

## Static Acceptance Checks

- Current bank values `Bay Harbor Credit Union`, `091000019`, and
  `740182936451` appear in document bodies only in doc `031`.
- Current employment values `Client Operations Associate` and `2026-07-06`
  appear in document bodies only in doc `035`.
- Manifest includes for banking facts point only at doc `031`.
- Manifest includes for `employment.title` and `employment.startDate` point
  only at doc `035`.
- The new packet contains no stale copied `packet-hard-conflict-v1` corpus ids
  or seeds.

## Validation Commands

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-hard-required-v1 --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-hard-required-v1
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-hard-required-v1
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-hard-required-v1
```

## Non-Goals

- Do not change runner, scorer, backend, MCP, form maps, schema, or
  `profile.yaml`.
- Do not make address/email, W-4 tax fields, or I-9 identity facts required-hard
  in this first combined packet.
- Do not add new scoring metadata beyond reusing existing `ownershipAudit` for
  Noah Kim's decoy values.
