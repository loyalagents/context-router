# Step 04: Storage Boundaries

- Status: complete — human-merged through PR #163 at `3426dc556fea88d94a360329e7c685bc9acc155e`
- Program step: `04-storage-boundaries`
- Target branch: `main`
- Working branch: `codex/local-migration-04-storage-boundaries`
- Planning base: `311f5a09b9b1ee5d43717296fbb49e7d45feda5e`
- Coordinator: `/root`, repository-read-only
- Planning/implementation owner and sole repository writer: `/root/storage_writer`
- Change classification: `local-only`; `hosted-v1-maintenance` is unchanged
- Intended implementation: one PR with five internal testable checkpoints
- Implementation PR and final evidence: [#163](https://github.com/loyalagents/context-router/pull/163)
- Supported modes: retained `hosted-baseline` and explicit non-listening `local-identity-preview`, with PostgreSQL as the reference adapter
- Last updated: 2026-09-23

## Outcome And Entry Evidence

Extract application-owned storage and transaction behavior, retain the PostgreSQL reference implementation, and establish reusable real-adapter tests before a second database is implemented. Preserve mutation/audit atomicity, access logging, identity/recovery, reset, catalog and public consumer contracts. Remove sample users from the actual production seed entrypoint.

Step 03 PR [#162](https://github.com/loyalagents/context-router/pull/162) was human-merged at `1b35c7c513b01a183bb740f0596273baf7620a10` from final tested head `cfe3b63786e729e60fd6f954c172db86487bebd4`. Standard CI [35899268852](https://github.com/loyalagents/context-router/actions/runs/35899268852) and dedicated migration gate [35899268881](https://github.com/loyalagents/context-router/actions/runs/35899268881) succeeded on that head. Its [plan](../03-local-identity/plan.md), including R1 and LM-015 recovery semantics, remains required.

Fresh `origin/main` equals the recorded planning base and includes only the already-observed agent-policy documentation after Step 03. Complete non-shallow history, prerequisite ancestry and a clean dedicated worktree were verified. Before activation edits, the exact-base twelve-phase migration gate passed with Node 24.21.0, pnpm 10.25.0, Python 3.12.8 and PostgreSQL 15.15. Base comparison was performed, caller integrity remained true, and cleanup succeeded. The supplied isolated tmpfs loopback administration container was ownership-verified, stopped and auto-removed. Detailed phase/timing evidence is in the [plan](plan.md#entry-criteria-and-evidence).

## Planning And Review

Read [orchestration](../orchestration.md), [decision log](../decision-log.md), [agent execution](../agent-execution.md), [agent workflow](../../../../useful/AGENT_WORKFLOW.md), and all [plan required reading](plan.md#required-reading). Parallel read-only discovery covered consumers/generated types/composition, transaction/identity/recovery, and tests/public consumers/seed/gate implications.

Fresh independent architecture/scope, persistence/recovery, security/privacy, compatibility/consumers and tests/gate reviews approved draft A without blockers. Findings and approvals bind to reviewed areas/revisions in the plan. After approval, the sole writer implements tests first, checkpoint by checkpoint, and obtains fresh final full-diff review plus exact-base local and final-head remote evidence.

The implementation and targeted checkpoint evidence are recorded in the [plan](plan.md#checkpoint-evidence). The enduring contracts are in [storage boundaries](../../../../current/STORAGE_BOUNDARIES.md). Fresh complete-diff architecture/scope, persistence/recovery, security/privacy, compatibility/consumers and tests/gate reviews approved candidate `01d5bd44551f89b8c675a3735a5c0361c1b006af` without actionable findings. The implementation PR records final-head local/remote validation. A human merged final head `c83bea0add7039cad814567e05d79f4f8b275aba` at `3426dc556fea88d94a360329e7c685bc9acc155e` on 2026-09-23 after standard CI [35928247258](https://github.com/loyalagents/context-router/actions/runs/35928247258) and dedicated migration gate [35928247421](https://github.com/loyalagents/context-router/actions/runs/35928247421) succeeded. These facts were freshly reverified during Step 05 activation.

Step 04 is complete. [Step 05](../05-local-database-runtime/README.md) is now the sole active primary step after its clean-base gate; Step 06 remains inactive. This retained plan records Step 04 implementation history and supplies required storage/recovery contracts to Step 05. No SQLite/database cutover, local model, MCP/browser/UI cutover, installer, LAN mode, historical-data migration, public-contract removal, or generic repository framework belongs here. There is no standalone planning/closeout PR and no automatic merge.
