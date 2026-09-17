# Local-First Migration

- Status: active program index
- Current step: `02-composition-boundaries` — PR 02B toolchain contract local
  implementation and independent review are complete after PR 02A
  ([#157](https://github.com/loyalagents/context-router/pull/157)) merged at
  `5a2fc8a09e9091d16160caea258d678293a1e2b3`
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-02-toolchain-contract`
- Concrete next action: publish the final reviewed head, run the dedicated
  migration workflow and all applicable standard CI, verify the external
  Vercel settings implement LM-014, resolve any remote finding, and leave
  landing to a human; promote the exact toolchain only after those gates pass
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
