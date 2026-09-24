# Step 05: Local Database Runtime

- Status: CP1 feasibility complete; affected selection review pending before full adapters
- Program step: `05-local-database-runtime`
- Target branch: `main`
- Working branch: `codex/local-migration-05-local-database-runtime`
- Planning base: `3426dc556fea88d94a360329e7c685bc9acc155e`
- Coordinator: `/root`, repository-read-only
- Planning/implementation owner and sole repository writer: `/root/step05_writer`
- Change classification: `local-only`; preserved hosted line and external deployments are untouched
- Intended PR count: one cohesive PR with internal testable checkpoints
- Last updated: 2026-09-23

## Outcome And Entry Evidence

Implement a fresh file-backed local database behind Step 04's application-owned storage contracts, including stable identity, restart, explicit recovery and matching database/identity backup feasibility. The actual local preview remains non-listening and has no PostgreSQL, Docker, Auth0 or hosted-model runtime dependency. SQLite/access-library selection is provisional until the reviewed bounded feasibility checkpoint passes. Preserve hosted and explicit PostgreSQL identity-reference coverage.

Step 04 [PR #163](https://github.com/loyalagents/context-router/pull/163) was human-merged at the planning base from tested head `c83bea0add7039cad814567e05d79f4f8b275aba`. Fresh GitHub verification confirms successful standard CI [35928247258](https://github.com/loyalagents/context-router/actions/runs/35928247258) and dedicated migration gate [35928247421](https://github.com/loyalagents/context-router/actions/runs/35928247421). Fresh origin/main matches, full history/connectivity and prerequisite ancestry pass, and this dedicated worktree was clean.

Before any activation/product edits, the exact-base full migration gate passed all twelve phases on Node 24.21.0, pnpm 10.25.0, Python 3.12.8 and isolated loopback PostgreSQL 15.15. Base comparison was performed, caller integrity true and all owned resources cleaned. Full source/base/toolchain/phase/timing/cleanup evidence is in the [plan](plan.md#activation-gate).

## Planning And Review

Read [orchestration](../orchestration.md), [decisions](../decision-log.md), [agent execution](../agent-execution.md), [workflow](../../../../useful/AGENT_WORKFLOW.md) and the exact [required reading](plan.md#required-reading). Retain the complete Step 04 plan and Step 03 recovery/R1 plan while these contracts are needed.

The [initial plan](plan.md) first establishes the durable-state/failure model, then proposes one bounded node:sqlite feasibility candidate. Fresh independent plan reviews and coordinator approval precede executable feasibility. Successful feasibility requires a recorded database/library/bootstrap/transaction/backup decision and affected review before full adapter work. Implementation then proceeds tests first without a generic permission pause, followed by fresh complete-diff reviews and exact final-head evidence.

The [CP1 feasibility and proposed selection](feasibility.md) records the exact runtime, file/process/backup probes and PostgreSQL characterization. LM-003/LM-015 mechanism additions remain proposals until affected independent selection review passes.

Step 05 is the sole active primary step. No local model, MCP/browser/UI cutover, installer, LAN service, historical importer, cloud sync, automatic merge or Step 06 activation belongs here.
