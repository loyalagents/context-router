# Local-First Migration

- Status: active program index
- Current step: `02-composition-boundaries` — plan independently approved;
  PR 02A (hosted model binding) is the only active implementation checkpoint
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-02-composition-boundaries`
- Concrete next action: commit and push the approved planning checkpoint, open
  PR 02A as a draft, then implement only its test-first hosted-model binding;
  keep the PR unmerged for human review
- Review date: 2026-10-14 or PR 02A implementation review, whichever comes first
- Last reviewed: 2026-09-16

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Run Step 02 PR 02A

1. Follow the independently approved Step 02
   [`plan.md`](02-composition-boundaries/plan.md) and its five-PR landing order.
2. Preserve the exact Step 01 merge base
   `ff9d8bce6f1b5b28752ab1582e47947f131eff8c` for PR 02A and bind every local
   aggregate run to that base.
3. Commit/push the planning checkpoint and open the current branch as a draft
   PR before product implementation.
4. Add PR 02A tests first, make only the approved model token/root/import
   changes, run targeted tests, backend build, and the exact-base full LMBG,
   then obtain fresh read-only implementation review and required CI. Never
   auto-merge.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
