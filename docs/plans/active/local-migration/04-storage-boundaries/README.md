# Step 04: Storage Boundaries

- Status: approved plan; implementation in progress
- Program step: `04-storage-boundaries`
- Target branch: `main`
- Working branch: `codex/local-migration-04-storage-boundaries`
- Planning base: `311f5a09b9b1ee5d43717296fbb49e7d45feda5e`
- Coordinator: `/root`, repository-read-only
- Planning/implementation owner and sole repository writer: `/root/storage_writer`
- Change classification: `local-only`; `hosted-v1-maintenance` is unchanged
- Intended implementation: one PR with five internal testable checkpoints
- Supported modes: retained `hosted-baseline` and explicit non-listening `local-identity-preview`, with PostgreSQL as the reference adapter
- Last updated: 2026-09-23

## Outcome And Entry Evidence

Extract application-owned storage and transaction behavior, retain the PostgreSQL reference implementation, and establish reusable real-adapter tests before a second database is implemented. Preserve mutation/audit atomicity, access logging, identity/recovery, reset, catalog and public consumer contracts. Remove sample users from the actual production seed entrypoint.

Step 03 PR [#162](https://github.com/loyalagents/context-router/pull/162) was human-merged at `1b35c7c513b01a183bb740f0596273baf7620a10` from final tested head `cfe3b63786e729e60fd6f954c172db86487bebd4`. Standard CI [35899268852](https://github.com/loyalagents/context-router/actions/runs/35899268852) and dedicated migration gate [35899268881](https://github.com/loyalagents/context-router/actions/runs/35899268881) succeeded on that head. Its [plan](../03-local-identity/plan.md), including R1 and LM-015 recovery semantics, remains required.

Fresh `origin/main` equals the recorded planning base and includes only the already-observed agent-policy documentation after Step 03. Complete non-shallow history, prerequisite ancestry and a clean dedicated worktree were verified. Before activation edits, the exact-base twelve-phase migration gate passed with Node 24.21.0, pnpm 10.25.0, Python 3.12.8 and PostgreSQL 15.15. Base comparison was performed, caller integrity remained true, and cleanup succeeded. The supplied isolated tmpfs loopback administration container was ownership-verified, stopped and auto-removed. Detailed phase/timing evidence is in the [plan](plan.md#entry-criteria-and-evidence).

## Planning And Review

Read [orchestration](../orchestration.md), [decision log](../decision-log.md), [agent execution](../agent-execution.md), [agent workflow](../../../../useful/AGENT_WORKFLOW.md), and all [plan required reading](plan.md#required-reading). Parallel read-only discovery covered consumers/generated types/composition, transaction/identity/recovery, and tests/public consumers/seed/gate implications.

Fresh independent architecture/scope, persistence/recovery, security/privacy, compatibility/consumers and tests/gate reviews approved draft A without blockers. Findings and approvals bind to reviewed areas/revisions in the plan. After approval, the sole writer implements tests first, checkpoint by checkpoint, and obtains fresh final full-diff review plus exact-base local and final-head remote evidence.

Step 04 is the only primary step. Steps 05 and 06 remain inactive. No SQLite/database cutover, local model, MCP/browser/UI cutover, installer, LAN mode, historical-data migration, public-contract removal, or generic repository framework belongs here. There is no standalone planning/closeout PR and no automatic merge.
