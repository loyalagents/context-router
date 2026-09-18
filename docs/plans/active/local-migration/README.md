# Local-First Migration

- Status: active program index
- Current step: `02-composition-boundaries` — PR 02E staged packaging
  feasibility is active after PR 02D runtime resources and production package
  closure [#160](https://github.com/loyalagents/context-router/pull/160) was
  human-merged at `9c54f98fd9ef4ac2bc39d5b4c12d1b91a266f2cf`
  after final-head standard CI run
  [35197826400](https://github.com/loyalagents/context-router/actions/runs/35197826400)
  and dedicated LMBG run
  [35197826476](https://github.com/loyalagents/context-router/actions/runs/35197826476)
  passed. PR 02E is activated from that exact SHA on
  `codex/local-migration-02-packaging-smoke`; its exact-base activation gate
  passed, the bounded plan clarifications are independently approved, and
  implementation, the 244-test local-migration suite, the original three
  correction reviews and both final CI-correction review rounds, the
  167.223-second final-tree direct packaging smoke, and the 454.088-second
  exact-base 12-phase LMBG are complete; final-head standard
  and dedicated remote validation remain pending
- Outcome owner and sole writer: `/root` on
  `codex/local-migration-02-packaging-smoke`
- Concrete next action: commit/push PR 02E, run final-head standard and dedicated
  remote CI, and resolve any final-head review findings; leave
  landing to a human and keep dependent Step 03/06 work inactive until PR 02E
  is human-merged or an explicit non-overlap is approved
- Review date: 2026-10-15 or the PR 02E human landing decision, whichever comes
  first
- Last reviewed: 2026-09-18

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Implement And Review Step 02 PR 02E

1. Follow the independently approved Step 02
   [`plan.md`](02-composition-boundaries/plan.md) and its five-PR landing order.
2. Preserve the exact PR 02D merge base
   `9c54f98fd9ef4ac2bc39d5b4c12d1b91a266f2cf` for PR 02E and bind every local
   aggregate run to that base.
3. Keep PR 02E limited to target-native staged backend/web artifacts, the
   bounded production lifecycle smoke, and its atomic LMBG/CI evidence. Do not
   enter local identity, storage, model, UI shell, installer, final platform,
   or zero-egress policy.
4. Require final-head local and remote evidence plus resolved fresh read-only
   review, and leave landing to a human.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
