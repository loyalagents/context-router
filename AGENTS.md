Before starting:

1. Read `README.md`.
2. Run `./print-repo-structure.sh`.
3. Read `docs/README.md`.
4. Read every file in `docs/IMPORTANT/`.
5. Use `docs/useful/`, `docs/current/`, and `docs/plans/active/` as needed.

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
