# Local-First Migration

- Status: active program index
- Current step: `02-composition-boundaries` — PR 02D runtime resources and
  production package closure [#160](https://github.com/loyalagents/context-router/pull/160)
  is open as a draft after PR 02C
  [#159](https://github.com/loyalagents/context-router/pull/159) merged at
  `143515dac687ffbca989a315edaa89e794a04db3`; local implementation and review
  are complete, with final-head remote checks pending
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-02-runtime-resources`
- Concrete next action: complete final-head standard CI and the dedicated
  migration gate for PR #160, then mark it ready and leave landing to a human;
  keep PR 02E inactive until PR 02D is human-merged and PR 02E's activation
  gate is complete
- Review date: 2026-10-14 or the PR 02D human landing decision, whichever comes
  first
- Last reviewed: 2026-09-17

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Implement And Review Step 02 PR 02D

1. Follow the independently approved Step 02
   [`plan.md`](02-composition-boundaries/plan.md) and its five-PR landing order.
2. Preserve the exact PR 02C merge base
   `143515dac687ffbca989a315edaa89e794a04db3` for PR 02D and bind every local
   aggregate run to that base.
3. Keep PR 02D limited to cwd-independent schema/catalog resources, sanitized
   pre-readiness integrity failure, and independently deployable backend
   production dependency closure. Do not enter the staged backend/web smoke,
   local identity, storage, model, UI, or installer policy.
4. Require final-head local and remote evidence plus resolved fresh read-only
   review, leave landing to a human, and do not activate PR 02E beforehand.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
