# Local-First Migration

- Status: active program index
- Current step: `03-local-identity` — activated from the human-merged Step 02
  PR [#161](https://github.com/loyalagents/context-router/pull/161) SHA
  `6b420ed24e9dd344af8990c9045832990ae1b5ec`; activation preflight and the
  exact-base 12-phase LMBG passed. The user then confirmed existing users may be
  wiped and prioritized future-provider compatibility; four renewed review
  dimensions approved the materially revised detailed plan. All five
  checkpoints are implemented and the exact-base local closeout gate passed in
  PR [#162](https://github.com/loyalagents/context-router/pull/162)
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-03-local-identity`
- Concrete next action: verify final pushed-head standard CI and the dedicated
  migration workflow for PR #162, then leave review and landing to a human
- Review date: 2026-10-16 or the Step 03 human landing decision, whichever comes
  first
- Last reviewed: 2026-09-23

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

For future Steps 04–11, use [`agent-execution.md`](agent-execution.md) for the
agreed agent/effort allocations, sensitive-work priorities, checkpoint sketches,
and overlap candidates. This is execution strategy, not step activation or an
approved implementation plan. General guidance lives in
[`AGENT_WORKFLOW.md`](../../../useful/AGENT_WORKFLOW.md).

## Plan, Implement, And Review Step 03

1. Follow the Step 03 [`README.md`](03-local-identity/README.md) and approved
   revised [`plan.md`](03-local-identity/plan.md).
2. Preserve the exact Step 02 merge base
   `6b420ed24e9dd344af8990c9045832990ae1b5ec` and bind activation/final aggregate
   runs to it.
3. Keep one PR and one sole writer. Review agents remain read-only; the five
   checkpoints are internal validation milestones.
4. Preserve hosted HTTP/web/MCP shapes for fresh main-line state while removing
   historical-user migration, adding the provider-neutral assertion, and adding
   only the explicit non-listening local-identity preview. Do not enter storage/
   model/MCP/UI/installer/LAN work owned by later steps.
5. Require final-head local and remote evidence plus resolved fresh review, and
   leave landing to a human.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
