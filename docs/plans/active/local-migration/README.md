# Local-First Migration

- Status: active program index
- Current step: `02-composition-boundaries` — plan and PR 02A
  ([#157](https://github.com/loyalagents/context-router/pull/157)) implementation
  independently approved; PR 02A remains unmerged
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-02-composition-boundaries`
- Concrete next action: obtain the required final-head local and remote check
  evidence, then a human review and landing decision; do not activate PR 02B
  before PR 02A is human-merged and its exact merge SHA is recorded
- Review date: 2026-10-14 or the PR 02A human landing decision, whichever comes
  first
- Last reviewed: 2026-09-16

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Review And Land Step 02 PR 02A

1. Follow the independently approved Step 02
   [`plan.md`](02-composition-boundaries/plan.md) and its five-PR landing order.
2. Preserve the exact Step 01 merge base
   `ff9d8bce6f1b5b28752ab1582e47947f131eff8c` for PR 02A and bind every local
   aggregate run to that base.
3. Keep [PR #157](https://github.com/loyalagents/context-router/pull/157)
   limited to the approved hosted-model binding, require final-head local and
   remote evidence plus resolved read-only review, and leave its landing to a
   human. Never auto-merge.
4. Only after PR 02A is human-merged, record its exact `main` merge SHA; verify
   `HEAD`, local and remote `main`, both merge bases, full history, a clean
   worktree, and hotspot ownership; assign a fresh sole writer and fresh
   read-only reviewers; and pass the bound entry gate before activating PR 02B.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
