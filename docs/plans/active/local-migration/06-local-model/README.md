# Step 06: Local Model

- Status: active CP3, paused; review fixes and repeat quality pass, but repeat native cancellation blocks acceptance
- Branch: `codex/local-migration-06-local-model`; target `main`
- Planning base: `837701b3633eed669dd2c2c518ffebc0e46d55d8`
- Coordinator and sole repository writer: `/root`; all other agents read-only
- Intended PR count: one cohesive PR: [#165](https://github.com/loyalagents/context-router/pull/165), draft until final gates pass
- Last updated: 2026-09-25

The clean-base twelve-phase activation gate passed before preparation documents were copied. The original dirty workspace remains untouched; ten inventoried files transferred with exact content hashes. See the [plan](plan.md#entry-criteria-and-activation-evidence) for source/base, timings, toolchain, integrity and cleanup evidence.

Implement one manually provisioned Apple Silicon inference configuration behind the existing AI ports, preserving non-AI behavior, local identity/storage and hosted/reference compatibility. Prefer pinned llama.cpp, require measured selection before integration, keep inference separate from process ownership, and leave UI/MCP listeners and managed lifecycle to their owning steps.

The [plan](plan.md), including transport amendment C, has independent architecture, compatibility and safety approval for bounded CP1 only. The user has approved the pinned runtime and 4B model, optional 9B only if useful, temporary storage under `/private/tmp/context-router-step06-assets`, and initial qualification on the observed M1 Max/64 GiB/macOS 15.1.1. No further initial consent is pending. Lower hardware/other OS versions remain unqualified. Deterministic harness checks precede live execution. Selection review precedes production integration. Follow the [handoff](../step-06-handoff.md), [orchestration](../orchestration.md), [decisions](../decision-log.md), [agent execution](../agent-execution.md) and [research synthesis](../research/local-model/README.md).

Existing no-model previews remain supported throughout. No product code or model assets have changed at activation. Final live and deterministic evidence, fresh complete-diff review, final local gate and final pushed-head CI remain required before the single PR is ready for human review. Do not merge automatically or activate another step.

The [selection record](selection.md) is independently approved for CP2 tests-first integration at `eee89f960e235daa1f2b5b77312eb114f1fc80ac`. Select pinned llama.cpp b11146 and Qwen3.5-9B Q4_K_M, batch 512, on the observed M1 Max/64 GiB/macOS 15.1.1. The original quality verdict remains FAILED; human-approved E accepts only the known email omission. G cancellation, resources, schemas, PDF closure, manual session claim and remaining negative checks passed their scoped reviews. All 129 deterministic feasibility tests pass. Historical failed runs and amendment decisions remain in the [feasibility record](feasibility.md) and [plan](plan.md).

Application integration and the independently reviewed follow-up fixes are implemented. Repeat native quality and stronger supplemental checks pass under unchanged E. The follow-up cancellation run failed its first prefill settlement and safely latched unavailable; historical successful cancellation/final gates do not override this new result. See the [retained failure and review](implementation.md#independent-review-follow-up) and [proposed bounded diagnostic](plan.md#follow-up-result-and-proposed-diagnostic-decision). PR #165 stays draft pending the required diagnostic decision and resolution, followed by renewed final local/CI gates. A separate Docker build-cache cleanup decision is pending after an ENOSPC build failure.
