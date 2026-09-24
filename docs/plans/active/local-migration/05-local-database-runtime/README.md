# Step 05: Local Database Runtime

- Status: implementation and CP5 integration complete; fresh complete-diff final review and exact final-head gate/CI pending
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

Implement a fresh file-backed local database behind Step 04's application-owned storage contracts, including stable identity, restart, explicit recovery and matching database/identity backup feasibility. The actual local preview remains non-listening and has no PostgreSQL, Docker, Auth0 or hosted-model runtime dependency. SQLite and the built-in node:sqlite library were selected after the reviewed bounded feasibility checkpoint. Preserve hosted and explicit PostgreSQL identity-reference coverage.

Step 04 [PR #163](https://github.com/loyalagents/context-router/pull/163) was human-merged at the planning base from tested head `c83bea0add7039cad814567e05d79f4f8b275aba`. Fresh GitHub verification confirms successful standard CI [35928247258](https://github.com/loyalagents/context-router/actions/runs/35928247258) and dedicated migration gate [35928247421](https://github.com/loyalagents/context-router/actions/runs/35928247421). Fresh origin/main matches, full history/connectivity and prerequisite ancestry pass, and this dedicated worktree was clean.

Before any activation/product edits, the exact-base full migration gate passed all twelve phases on Node 24.21.0, pnpm 10.25.0, Python 3.12.8 and isolated loopback PostgreSQL 15.15. Base comparison was performed, caller integrity true and all owned resources cleaned. Full source/base/toolchain/phase/timing/cleanup evidence is in the [plan](plan.md#activation-gate).

## Planning And Review

Read [orchestration](../orchestration.md), [decisions](../decision-log.md), [agent execution](../agent-execution.md), [workflow](../../../../useful/AGENT_WORKFLOW.md) and the exact [required reading](plan.md#required-reading). Retain the complete Step 04 plan and Step 03 recovery/R1 plan while these contracts are needed.

The [initial plan](plan.md) first establishes the durable-state/failure model, then proposes one bounded node:sqlite feasibility candidate. Fresh independent plan reviews and coordinator approval precede executable feasibility. Successful feasibility requires a recorded database/library/bootstrap/transaction/backup decision and affected review before full adapter work. Implementation then proceeds tests first without a generic permission pause, followed by fresh complete-diff reviews and exact final-head evidence.

The [CP1 feasibility and accepted selection](feasibility.md) records the exact runtime, file/process/backup probes and PostgreSQL characterization. All affected independent selection reviews approved frozen revision `0a6cda5af9ec90415792d2813f097e6bce62bfaa`, and the coordinator authorized production implementation.

Step 05 is the sole active primary step. No local model, MCP/browser/UI cutover, installer, LAN service, historical importer, cloud sync, automatic merge or Step 06 activation belongs here.

## Implementation Candidate

The actual local runtime, real file-backed contracts/application/process/recovery and matching-pair backup mechanism are implemented. Source and sealed relocated package starts pass on macOS arm64 with Node 24.21.0 / pnpm 10.25.0 / SQLite 3.53.4. Gate/CI discovery adds the local project and independent ten-resource SQLite lifecycle proof while retaining the twelve phases, eight-resource PostgreSQL reference proof and hosted/web coverage. Canonical docs distinguish fresh SQLite roots from preserved PostgreSQL state.

Checkpoint evidence and limitations are recorded in the [plan](plan.md#cp5-integration-and-package-evidence). Fresh complete planning-base-to-candidate review, final exact-base full gate and final pushed-head standard/dedicated CI are still required. This is a review candidate, not merge approval; Step 06 remains inactive.
