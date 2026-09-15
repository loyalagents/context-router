# Local-First Migration

- Status: active program index
- Current step: `01-contract-baseline-and-product-scope` — ready for planning
- Outcome owner: local-migration coordinator (`/root`) until a Step 01 sole
  writer is assigned
- Concrete next action: create `codex/local-migration-01-contract-baseline`,
  write `01-contract-baseline-and-product-scope/plan.md` from the template, and
  obtain independent plan review before implementation
- Review date: 2026-10-14 or Step 01 plan approval, whichever comes first
- Last reviewed: 2026-09-14

Start with [`orchestration.md`](orchestration.md). It defines the target,
roadmap, branch policy, agent workflow, and merge gates. Cross-step decisions
live in [`decision-log.md`](decision-log.md).

## Start Step 01

1. Read the orchestration, decision log, and
   [`01-contract-baseline-and-product-scope/README.md`](01-contract-baseline-and-product-scope/README.md).
2. Create the assigned Step 01 branch from `main` after Step 00 PR
   [#155](https://github.com/loyalagents/context-router/pull/155) merges.
3. Copy [`step-template.md`](step-template.md) to the Step 01 directory as
   `plan.md`, record the exact base commit and ownership, and plan PR-sized
   checkpoints.
4. Obtain independent architecture, compatibility, testing, and
   security/privacy review; resolve every finding before implementation.

Only activated steps have detailed directories. Create later step directories
from the template when they are activated; an explicitly approved overlap may
temporarily activate two, but placeholder plans should not accumulate.

The optional cross-cutting route and schema process is documented in
[`tracks/interface-evolution.md`](tracks/interface-evolution.md).
