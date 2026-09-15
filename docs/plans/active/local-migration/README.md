# Local-First Migration

- Status: active program index
- Current step: `00-document-consolidation` — PR 00A merged; PR 00B
  [#154](https://github.com/loyalagents/context-router/pull/154) is ready for
  human review
- Last reviewed: 2026-09-14

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Continue Step 00

1. Read the orchestration, decision log, and
   [`00-document-consolidation/README.md`](00-document-consolidation/README.md).
2. For PR 00B, follow the independently approved
   [`00b-plan.md`](00-document-consolidation/00b-plan.md).
3. After 00B merges, create a separate 00C branch to perform the reviewed
   deletion and strict-link closeout.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
