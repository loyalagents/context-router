Before starting:

1. Read `README.md`.
2. Run `./print-repo-structure.sh`.
3. Read every file in `docs/IMPORTANT/`.
4. Use `docs/current/`, `docs/useful/`, and `docs/plans/active/` as needed for your task.

For docs writing rules, read `docs/README.md`. That file is not needed at startup for most tasks.

This repo is a monorepo with:

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
