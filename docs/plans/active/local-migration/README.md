# Local-First Migration

- Status: active program index
- Last completed step: `07-local-mcp` — [PR #166](https://github.com/loyalagents/context-router/pull/166); merge/evidence and limitations in its [closeout](07-local-mcp/README.md)
- Current primary implementation step: `08-local-ui` — implemented; independent reviews and full local gate passed; user-run acceptance complete with accepted evidence limits; awaiting human PR disposition
- Concrete next action: publish documentation closeout and verify final pushed-head CI on draft PR #167, then await human disposition; do not mark ready or merge
- Review date: 2026-10-04 — Step 08 final implementation approvals and user-run acceptance disposition
- Last reviewed: 2026-10-04

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

Step 08's [acceptance disposition](08-local-ui/acceptance.md) records completed
user-run testing and accepted evidence limits. The small
[UI usability follow-up](../ui-usability/README.md) is deferred until the packaged
local workflow is usable; it does not activate Step 09 or block this closeout.

For future Steps 04–11, use [`agent-execution.md`](agent-execution.md) for the
agreed agent/effort allocations, sensitive-work priorities, checkpoint sketches,
and overlap candidates. This is execution strategy, not step activation or an
approved implementation plan. General guidance lives in
[`AGENT_WORKFLOW.md`](../../../useful/AGENT_WORKFLOW.md).

## Prepare And Execute Step 08

1. Read the [handoff](step-08-handoff.md) and accepted LM-021/022 in the decision log. Reuse the existing dashboard; no redesign or installer.
2. Use Astra Extra High for the coordinator/sole writer, role-specific High/Extra High read-only investigation and fresh independent review. One cohesive PR with internal checkpoints is the default.
3. Add a safe local browser session, useful non-AI and capability-gated AI flows, basic per-instance MCP management and simple history semantics. UI and MCP share local state and the single inference owner, not credentials.
4. Keep full credential onboarding in the [deferred product follow-up](../mcp-onboarding/README.md). Future UI is additive to CLI; it does not block Step 09.
5. Retain required Step 03–07 plans/evidence and current runbooks. Preserve local data, identity, MCP clients, Step 06 E/H limitations and supported modes. The handoff handles clean-base validation without losing uncommitted preparation docs or creating a development worktree.

Step 08 passed clean-base activation and restored the preparation documents;
see its [activation evidence](08-local-ui/activation.md). Its P2 technical plan
has all four independent approvals recorded in the review ledger. Carry preparation docs into the same PR. Historical Step 06 research and its
handoff remain context, not new experiment authority.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
