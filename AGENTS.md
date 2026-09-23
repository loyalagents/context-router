Before starting:

1. Read `README.md`.
2. Run `./print-repo-structure.sh`.
3. Read `docs/README.md` to get a sense of the documents available in this repo.
4. Read every file in `docs/IMPORTANT/`.
5. Read `docs/current/`, `docs/useful/`, and `docs/plans/active/` as needed for your task.

This repo is a `pnpm` workspace monorepo with:

- `apps/backend`: NestJS + GraphQL + Prisma + MCP
- `apps/web`: Next.js dashboard and support routes

When adding or changing backend behavior:

- Write or update tests first.
- Do not change tests unless requirements changed.
- Run targeted tests after each change.
- Keep edits small and incremental.
- Stop when tests are green and summarize what changed.

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
