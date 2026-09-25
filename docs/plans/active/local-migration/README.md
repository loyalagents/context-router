# Local-First Migration

- Status: active program index
- Last completed step: `05-local-database-runtime` — [PR #164](https://github.com/loyalagents/context-router/pull/164), human-merged at `837701b3633eed669dd2c2c518ffebc0e46d55d8` from tested head `91b86b1b412cc8b2b914ffe4f321a7a0cf1f370b`
- Step 05 final evidence: standard CI [35957573071](https://github.com/loyalagents/context-router/actions/runs/35957573071) and dedicated migration gate [35957573023](https://github.com/loyalagents/context-router/actions/runs/35957573023), both successful on that head; reverified 2026-09-24
- Current primary implementation step: `06-local-model` — [active plan](06-local-model/plan.md), selection approved; implementation and review fixes complete; CP3 paused on repeat cancellation evidence
- Coordinator and sole repository writer for Step 06: `/root`; all other agents read-only
- Concrete next action: decide the [bounded cancellation diagnostic](06-local-model/plan.md#follow-up-result-and-proposed-diagnostic-decision); resolve the failure before renewed final gates and ready status for draft PR #165
- Review date: Step 06 diagnostic decision or 2026-10-08, whichever comes first
- Last reviewed: 2026-09-25

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

For future Steps 04–11, use [`agent-execution.md`](agent-execution.md) for the
agreed agent/effort allocations, sensitive-work priorities, checkpoint sketches,
and overlap candidates. This is execution strategy, not step activation or an
approved implementation plan. General guidance lives in
[`AGENT_WORKFLOW.md`](../../../useful/AGENT_WORKFLOW.md).

## Prepare And Execute Step 06

1. Start with the [handoff](step-06-handoff.md) and [research synthesis](research/local-model/README.md). The original GPT/Gemini reports are preserved beside the synthesis with warnings and corrections; they are not approved plans or setup scripts.
2. Target Apple Silicon first, with manual runtime/model setup now and a managed app later. Native Windows/Linux qualification is an early Step 09 follow-up, not a Step 06 whole-app support promise.
3. Prefer a bounded pinned `llama.cpp` feasibility candidate; choose the exact runtime/model/capabilities through reviewed evidence, not report benchmarks. Keep one PR with internal feasibility, integration and acceptance checkpoints.
4. Use Astra Extra High for the orchestrator, role-specific High/Extra High work, one sole writer and fresh independent review. The handoff specifies clean-base activation when these preparation docs are still uncommitted.
5. Retain the Step 05 [README](05-local-database-runtime/README.md), [plan](05-local-database-runtime/plan.md) and feasibility evidence, plus the Step 04 [plan](04-storage-boundaries/plan.md) and Step 03 [recovery/R1 plan](03-local-identity/plan.md) while required. Preserve identity, storage and supported reference modes.

Step 06 is now the sole active step after its clean-base gate. Plan C has independent approval for bounded feasibility. Required asset/target decisions precede live execution; affected selection review precedes product implementation.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
