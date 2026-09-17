# Local-First Migration

- Status: active program index
- Current step: `02-composition-boundaries` — PR 02B toolchain contract
  implementation and independent review are complete; candidate head
  `e84e39867797801c2ab8cbfe1547ebb4d34c1a1f` passed the required GitHub checks
  and LM-014 external verification after PR 02A
  ([#157](https://github.com/loyalagents/context-router/pull/157)) merged at
  `5a2fc8a09e9091d16160caea258d678293a1e2b3`
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-02-toolchain-contract`
- Concrete next action: maintain PR
  [#158](https://github.com/loyalagents/context-router/pull/158) closeout by
  keeping required checks green and its description synchronized on the
  documentation-only closeout head and any later head, mark or keep the PR
  ready, then leave review and landing to a human and keep PR 02C inactive;
  after PR 02B merges, record the exact merge SHA, activate PR 02C from that
  base, and promote the exact toolchain contract to the landed baseline
- Review date: 2026-10-14 or the PR 02B human landing decision, whichever comes
  first
- Last reviewed: 2026-09-16

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Implement And Review Step 02 PR 02B

1. Follow the independently approved Step 02
   [`plan.md`](02-composition-boundaries/plan.md) and its five-PR landing order.
2. Preserve the exact PR 02A merge base
   `5a2fc8a09e9091d16160caea258d678293a1e2b3` for PR 02B and bind every local
   aggregate run to that base.
3. Keep PR 02B limited to eval discovery and the exact Node.js/pnpm contract,
   require final-head local and remote evidence plus resolved read-only review,
   and leave its landing to a human. Never auto-merge.
4. Do not activate PR 02C until PR 02B is human-merged and its exact `main`
   merge SHA is recorded.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
