# Local-First Migration

- Status: active program index
- Current step: `05-local-database-runtime` — Step 04 [PR #163](https://github.com/loyalagents/context-router/pull/163) was human-merged at `3426dc556fea88d94a360329e7c685bc9acc155e` from tested head `c83bea0add7039cad814567e05d79f4f8b275aba`
- Step 04 final evidence: standard CI [35928247258](https://github.com/loyalagents/context-router/actions/runs/35928247258) and dedicated migration gate [35928247421](https://github.com/loyalagents/context-router/actions/runs/35928247421), both successful on that head
- Step 05 planning base: `3426dc556fea88d94a360329e7c685bc9acc155e`; clean-base full activation gate passed all twelve phases before edits
- Coordinator: `/root`, repository-read-only
- Outcome owner and sole repository writer: `/root/step05_writer` on `codex/local-migration-05-local-database-runtime`
- Concrete next action: fresh complete-diff final review of the implemented Step 05 candidate, followed by exact final-head gate and CI in one PR
- Review date: 2026-10-07 or Step 05 final review, whichever comes first
- Last reviewed: 2026-09-23

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

For future Steps 04–11, use [`agent-execution.md`](agent-execution.md) for the
agreed agent/effort allocations, sensitive-work priorities, checkpoint sketches,
and overlap candidates. This is execution strategy, not step activation or an
approved implementation plan. General guidance lives in
[`AGENT_WORKFLOW.md`](../../../useful/AGENT_WORKFLOW.md).

## Execute Step 05

1. Read the Step 05 [README](05-local-database-runtime/README.md) and [plan](05-local-database-runtime/plan.md), including completed initial/selection review and checkpoint evidence.
2. Keep the Step 04 [plan](04-storage-boundaries/plan.md) and Step 03 [recovery/R1 plan](03-local-identity/plan.md) while their contracts remain required.
3. Keep one cohesive PR and `/root/step05_writer` as sole repository writer. The coordinator/reviewers remain read-only.
4. Preserve the accepted SQLite/library/bootstrap/transaction/backup decisions and reference modes; material mechanism changes require affected review. The actual local implementation and CP5 integration are complete.
5. Require real file/process/recovery/backup/package evidence, fresh complete-diff final review, exact-base local gate and final pushed-head CI. Leave merge to a human; do not activate Step 06.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
