# Step 06: Local Model

- Status: active primary step; draft plan under independent review
- Branch: `codex/local-migration-06-local-model`; target `main`
- Planning base: `837701b3633eed669dd2c2c518ffebc0e46d55d8`
- Coordinator and sole repository writer: `/root`; all other agents read-only
- Intended PR count: one cohesive PR; PR pending
- Last updated: 2026-09-24

The clean-base twelve-phase activation gate passed before preparation documents were copied. The original dirty workspace remains untouched; ten inventoried files transferred with exact content hashes. See the [plan](plan.md#entry-criteria-and-activation-evidence) for source/base, timings, toolchain, integrity and cleanup evidence.

Implement one manually provisioned Apple Silicon inference configuration behind the existing AI ports, preserving non-AI behavior, local identity/storage and hosted/reference compatibility. Prefer pinned llama.cpp, require measured selection before integration, keep inference separate from process ownership, and leave UI/MCP listeners and managed lifecycle to their owning steps.

The [plan](plan.md) is draft and has no execution approval. Fresh independent plan review precedes bounded feasibility; runtime/model download consent and the qualified Mac target are pending user decisions. Selection review precedes production integration. Follow the [handoff](../step-06-handoff.md), [orchestration](../orchestration.md), [decisions](../decision-log.md), [agent execution](../agent-execution.md) and [research synthesis](../research/local-model/README.md).

Existing no-model previews remain supported throughout. No product code or model assets have changed at activation. Final live and deterministic evidence, fresh complete-diff review, final local gate and final pushed-head CI remain required before the single PR is ready for human review. Do not merge automatically or activate another step.
