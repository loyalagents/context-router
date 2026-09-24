# Step 06: Local Model

- Status: active primary step; 9B accuracy deferral approved; first native cancellation failed; user-approved smaller-batch experiment in progress; affected implementation review precedes measurement
- Branch: `codex/local-migration-06-local-model`; target `main`
- Planning base: `837701b3633eed669dd2c2c518ffebc0e46d55d8`
- Coordinator and sole repository writer: `/root`; all other agents read-only
- Intended PR count: one cohesive PR; PR pending
- Last updated: 2026-09-24

The clean-base twelve-phase activation gate passed before preparation documents were copied. The original dirty workspace remains untouched; ten inventoried files transferred with exact content hashes. See the [plan](plan.md#entry-criteria-and-activation-evidence) for source/base, timings, toolchain, integrity and cleanup evidence.

Implement one manually provisioned Apple Silicon inference configuration behind the existing AI ports, preserving non-AI behavior, local identity/storage and hosted/reference compatibility. Prefer pinned llama.cpp, require measured selection before integration, keep inference separate from process ownership, and leave UI/MCP listeners and managed lifecycle to their owning steps.

The [plan](plan.md), including transport amendment C, has independent architecture, compatibility and safety approval for bounded CP1 only. The user has approved the pinned runtime and 4B model, optional 9B only if useful, temporary storage under `/private/tmp/context-router-step06-assets`, and initial qualification on the observed M1 Max/64 GiB/macOS 15.1.1. No further initial consent is pending. Lower hardware/other OS versions remain unqualified. Deterministic harness checks precede live execution. Selection review precedes production integration. Follow the [handoff](../step-06-handoff.md), [orchestration](../orchestration.md), [decisions](../decision-log.md), [agent execution](../agent-execution.md) and [research synthesis](../research/local-model/README.md).

Existing no-model previews remain supported throughout. No product code or model assets have changed at activation. Final live and deterministic evidence, fresh complete-diff review, final local gate and final pushed-head CI remain required before the single PR is ready for human review. Do not merge automatically or activate another step.

The [feasibility record](feasibility.md#selection-stop-both-frozen-candidates-fail) retains both completed quality runs and the incomplete first 9B transport run. Both completed candidates missed the 90% extraction-recall requirement; 4B also failed absent-value negatives. Runtime, 4B and 9B assets are hash-verified outside Git. No model is selected, no production integration is authorized, and no PR is ready. The [proposed amendment D](plan.md#proposed-amendment-d-bounded-prompt-framing-experiment) makes the next requested decision concrete while preserving all original evidence and thresholds.

The user subsequently approved moving on with a documented accuracy limitation; see [amendment E](plan.md#amendment-e-user-directed-accuracy-deferral). Keep the original 9B recall failure visible and defer optional D tuning. 9B is provisional pending all remaining CP1 evidence and selection review; no production integration is approved yet.

The first native prefill-cancellation trial failed the unchanged recovery deadline and correctly latched unavailable; see [amendment F](plan.md#proposed-amendment-f-smaller-prefill-batch). The existing quality exception remains accepted. Integration is paused at this separate runtime blocker; no further model run proceeds before the F decision.

The user explicitly approved F (“yes you can test this”). Continue its bounded smaller-batch experiment after affected implementation review; quality deferral E remains accepted. Production selection/integration remain gated on the results and remaining qualification.
