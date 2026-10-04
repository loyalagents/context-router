# Step 07: Local MCP

- Status: active follow-up validation/review; P2 and session-recovery amendment independently approved; manual acceptance recorded for `d7e9d65`
- Branch: `codex/local-migration-07-local-mcp`; target `main`; existing checkout only
- Planning base: `cf18207e1197d0a1ffe5f598b5828c77c4711ad5`
- Coordinator and sole repository writer: `/root`; every other agent is read-only
- Intended PR count: one cohesive draft PR, including planning, implementation, tests and docs
- Last updated: 2026-09-29

Deliver direct loopback Streamable HTTP to Claude Code and Codex CLI on the same Mac, with one manually started backend, distinct per-instance credentials, the existing stable human identity and SQLite services, and the selected Step 06 model adapter. Ordinary operations work without inference. No stdio, wrapper, UI, LAN mode or managed model lifecycle is included.

The clean-base full twelve-phase activation gate passed with caller integrity and cleanup verified. Step 06's merged prerequisite and exact-head CI were freshly verified. See the [plan](plan.md) for evidence, reviewed boundaries and checkpoints, and [orchestration](../orchestration.md) for program status. Later steps remain inactive. Step 06's E/H limitations and failed historical qualification remain unchanged.

User-run acceptance and cleanup for `d7e9d65` are recorded in [PR #166](https://github.com/loyalagents/context-router/pull/166), with server/native cancellation explicitly unconfirmed. The PR is draft again for the session-recovery follow-up; affected independent review and full local/CI validation are required before returning it to human review. Carry forward prior evidence with its original revision limits. Never merge automatically or mark Step 07 complete before human merge.

See [implementation evidence](implementation.md) and the [single manual acceptance checklist](acceptance.md). Final immutable candidate/review/gate/CI receipts belong in the draft PR; no receipt-only source commit is required.
