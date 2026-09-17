# Local-First Migration

- Status: active program index
- Current step: `02-composition-boundaries` — PR 02C runtime
  configuration/bootstrap is locally implemented and independently approved
  in draft [#159](https://github.com/loyalagents/context-router/pull/159) after
  PR 02B
  ([#158](https://github.com/loyalagents/context-router/pull/158)) merged at
  `5a8b640a883dd33d42239d3a74e827cc17ffaae3`
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-02-runtime-bootstrap`
- Concrete next action: complete the dedicated migration workflow and all
  applicable standard CI for draft PR #159 on final HEAD, then prepare it for
  human review and landing; PRs 02D and 02E remain inactive
- Review date: 2026-10-14 or the PR 02C human landing decision, whichever comes
  first
- Last reviewed: 2026-09-16

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Implement And Review Step 02 PR 02C

1. Follow the independently approved Step 02
   [`plan.md`](02-composition-boundaries/plan.md) and its five-PR landing order.
2. Preserve the exact PR 02B merge base
   `5a8b640a883dd33d42239d3a74e827cc17ffaae3` for PR 02C and bind every local
   aggregate run to that base.
3. Keep PR 02C limited to runtime configuration, origin ownership, web public
   endpoint ownership, and hosted bootstrap lifecycle. Do not enter resource
   packaging, local identity, storage, model, UI, or installer policy.
4. Require final-head local and remote evidence plus resolved fresh read-only
   review, leave landing to a human, and do not activate PR 02D beforehand.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
