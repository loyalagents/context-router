# Local-First Migration

- Status: active program index
- Current step: `04-storage-boundaries` — Step 03 PR [#162](https://github.com/loyalagents/context-router/pull/162) was human-merged at `1b35c7c513b01a183bb740f0596273baf7620a10`; its final tested head `cfe3b63786e729e60fd6f954c172db86487bebd4` passed standard CI [35899268852](https://github.com/loyalagents/context-router/actions/runs/35899268852) and dedicated migration gate [35899268881](https://github.com/loyalagents/context-router/actions/runs/35899268881)
- Step 04 planning base: `311f5a09b9b1ee5d43717296fbb49e7d45feda5e`; clean-base activation gate passed all twelve phases before activation edits
- Coordinator: `/root`, repository-read-only
- Outcome owner and sole repository writer: `/root/storage_writer` on `codex/local-migration-04-storage-boundaries`
- Concrete next action: implement the independently approved Step 04 plan checkpoint by checkpoint and prepare one validated PR for human review
- Review date: 2026-10-07 or Step 04 plan approval, whichever comes first
- Last reviewed: 2026-09-23

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

For future Steps 04–11, use [`agent-execution.md`](agent-execution.md) for the
agreed agent/effort allocations, sensitive-work priorities, checkpoint sketches,
and overlap candidates. This is execution strategy, not step activation or an
approved implementation plan. General guidance lives in
[`AGENT_WORKFLOW.md`](../../../useful/AGENT_WORKFLOW.md).

## Plan, Implement, And Review Step 04

1. Follow the Step 04 [README](04-storage-boundaries/README.md) and [plan](04-storage-boundaries/plan.md). Product implementation waits for fresh independent plan approval.
2. Bind activation and final aggregate validation to the full recorded planning base. Preserve the Step 03 [plan](03-local-identity/plan.md) because its exact recovery contract remains required.
3. Keep one PR and `/root/storage_writer` as the sole writer. The coordinator and review agents remain read-only; checkpoints are internal validation milestones.
4. Extract storage and transaction behavior with PostgreSQL as the working reference adapter, preserve hosted/local preview modes and public contracts, and remove production seed sample users.
5. Require fresh final review and final-head local/remote evidence, and leave landing to a human. Do not activate Steps 05, 06 or another implementation track.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
