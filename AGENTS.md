Before starting:

1. Read `README.md`.
2. Run `./print-repo-structure.sh`.
3. Read `docs/README.md` to get a sense of the documents available in this repo.
4. Read every file in `docs/IMPORTANT/`.
5. Read `docs/current/`, `docs/useful/`, and `docs/plans/active/` as needed for your task.

This repo is a `pnpm` workspace monorepo with:

- `apps/backend`: NestJS + GraphQL + Prisma + MCP
- `apps/web`: Next.js dashboard and support routes

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

When working on the local-first migration:

- Read `docs/plans/active/local-migration/orchestration.md`,
  `docs/plans/active/local-migration/decision-log.md`, and the active step's
  `README.md` before planning or implementation.
- Follow the planning, independent-review, branch, and closeout gates in the
  orchestration document.
- When activating or planning Steps 04–11, also read
  `docs/plans/active/local-migration/agent-execution.md`. Its role allocations
  and overlap candidates do not activate a step or replace its reviewed plan.
