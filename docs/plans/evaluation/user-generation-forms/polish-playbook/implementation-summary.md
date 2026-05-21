# Polish And Playbook Implementation Summary

- Status: complete
- Date: 2026-05-21

## What Changed

- Added root `pnpm eval:verify` as the local non-DB eval gate. It runs
  `pnpm eval:test` and then `pnpm eval:validate`.
- Added a dedicated no-DB `eval-fixture-checks` CI job. The job uses the same
  Node 20 and pnpm 9 setup pattern as the existing jobs, installs from the repo
  root with `--frozen-lockfile`, and runs `pnpm eval:test` and
  `pnpm eval:validate` as separate steps.
- Added documented `--verbose` support to `pnpm eval:run`.
- Added tagged harness failure errors so verbose mode preserves the existing
  backend harness stdout/stderr diagnostic block without duplicating it through
  a stack trace.
- Added `examples/eval/PLAYBOOK.md` with contributor workflows for users,
  corpora, templates, field maps, scenarios, report-driven repair, and snapshot
  review.
- Updated `examples/eval/README.md` to link the playbook and clarify the
  difference between `eval:test`, `eval:validate`, and `eval:verify`.

## Runner Diagnostic Behavior

- `pnpm eval:run --scenario <scenarioId>` keeps concise failure output.
- `pnpm eval:run --scenario <scenarioId> --verbose` prints stacks for
  unexpected runner-internal failures.
- Backend harness failures remain message-only in verbose mode because their
  useful root-cause context is already in the formatted child-process
  stdout/stderr tail.
- Validation failures are unchanged; the validator already returns structured
  diagnostics.

## Deferred

- Optional LLM polish remains deferred. Batch 5 did not add real LLM calls.
- Archetypes and user factories remain deferred. The recommended next
  expansion is a second I-9 user, likely with a different work-authorization
  profile, before adding W-4 for Elena.
- DB-backed `pnpm eval:run` remains an optional/manual readiness check rather
  than required CI.

## Verification

Ran:

```bash
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Eval script tests passed.
- Full fixture validation passed with `profiles=1 corpora=2 forms=6 scenarios=2 templates=6 errors=0 warnings=0`.
- `pnpm eval:verify` passed.
- `pnpm-lock.yaml` was unchanged.
