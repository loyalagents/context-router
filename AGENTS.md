Before starting:

1. Read `README.md`.
2. Run `./print-repo-structure.sh`.
3. Read `docs/README.md` to get a sense of the documents available in this repo.
4. Read every file in `docs/IMPORTANT/`.
5. Read `docs/plans/README.md` for priorities, then `docs/current/`, `docs/useful/`,
   and the relevant active/backlog brief as needed for your task.

This repo is a `pnpm` workspace monorepo with:

- `apps/backend`: NestJS + GraphQL + Prisma + MCP
- `apps/web`: Next.js dashboard and support routes
- `apps/desktop`: native Mac menu/guardian and installed-app packaging

Validation for all repository changes (backend, web, native, packaging, and docs):

- Follow the [validation policy](docs/useful/AGENT_WORKFLOW.md#validation-and-context-discipline).
  During iteration, run focused checks for changed behavior and affected consumers;
  include integration, browser, native, persistence, or recovery tests as risk requires.
- Batch related corrections. Do not automatically run the full migration gate,
  complete package qualification, or every independent review after each small edit.
- A source/artifact-bound trial build may support a named human retest after the
  necessary checks and affected reviews. Report its scope and outstanding checks:
  "Targeted checks passed; final validation pending." A trial is not merge-ready.
- Agree the end-of-round finalization milestone, then freeze a candidate and run
  all required final gates. Changed inputs invalidate affected evidence; explicitly
  carry forward only unaffected coverage. Preserve backend tests-first rules below.
- Before an expensive broad run, explain its purpose, relevant changes since the
  last pass, and any plan requirement to run it now. Check toolchain prerequisites;
  parallelize independent checks only with isolated resources and stable inputs.
- Do not weaken tests, alter CI requirements/triggers, bypass safety or live-run
  approvals, overstate readiness, or merge automatically to shorten iteration.

When adding or changing backend behavior:

- Write or update tests first.
- Do not change tests unless requirements changed.
- Run targeted tests after each change.
- Keep edits small and incremental.
- Report targeted results and any pending final validation at each checkpoint.

When making plans for backend work:

- Use checkpoints.
- Each checkpoint should end at a place where tests can run and progress can be reported clearly.

When choosing models or coordinating substantive multi-agent work:

- Read `docs/useful/AGENT_WORKFLOW.md` for risk-based effort selection,
  sole-writer ownership, parallel work, and independent review.
- Record requested versus verified model/effort settings; do not assume every
  subagent should inherit the coordinator's tier. Active plan gates still apply.

When working on the local application or pilot:

- Read `docs/current/LOCAL_APPLICATION.md` and the relevant runbook/brief.
  The numbered migration is closed; its historical plans do not activate work.
- Prefer one cohesive PR with internal checkpoints. For substantive or sensitive
  work, independently review the plan before implementation and the complete diff
  before final handoff. Do not create one PR per agent, review or closeout phase.
- Keep one writer/integrator in the main checkout; use separate worktrees and
  isolated resources only for explicitly independent tasks. Preserve the user's
  running app and personal state. A backlog entry is not implementation approval.
- Existing `pnpm migration:gate`, contract baseline and CI requirements remain.
  Program closure does not authorize retiring gates or removing hosted adapters.
- Pilot releases may explicitly permit resets, but no silent deletion, arbitrary
  journal cleanup, off-device data submission or personal-client changes. Require
  bounded approval and preserve source documents and compatible model assets.
