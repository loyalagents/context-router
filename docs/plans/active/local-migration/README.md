# Local-First Migration

- Status: active program index
- Current step: `01-contract-baseline-and-product-scope` — remediation
  independently approved, local gate passed, and remote gate green at
  `d68dd6c`; [PR #156](https://github.com/loyalagents/context-router/pull/156)
  is prepared for final human review subject to final-head required checks
  remaining green
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-01-contract-baseline`
- Concrete next action: human review and merge decision for PR #156 only while
  required checks remain green and without automatic merge; begin Step 02
  planning only after it merges
- Review date: 2026-10-14 or Step 01 human review, whichever comes first
- Last reviewed: 2026-09-16

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Close Step 01 And Start Step 02

1. Read the orchestration, decision log, and the Step 01
   [`plan.md`](01-contract-baseline-and-product-scope/plan.md).
2. Run `pnpm migration:gate` with a validated full-history merge base and safe
   loopback PostgreSQL 15 administration connection; do not substitute a list
   of partial commands for the aggregate result.
3. Complete fresh read-only implementation review, resolve every finding as the
   sole writer, and leave the PR unmerged for human review.
4. After Step 01 merges, read the
   [`02-composition-boundaries` activation charter](02-composition-boundaries/README.md),
   create its assigned branch from `main`, copy [`step-template.md`](step-template.md)
   to `plan.md`, and obtain independent plan review before implementation.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
