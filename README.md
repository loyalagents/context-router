# Context Router

Context Router is a pnpm monorepo with a NestJS backend and a Next.js web app. The backend owns GraphQL, MCP, Auth0-backed auth, Prisma/Postgres persistence, permission grants, AI-backed workflows, and document analysis. The web app is mainly a dashboard for exercising and validating those systems.

## Start Here

If you are orienting yourself in the repo:

1. Run `./print-repo-structure.sh`.
2. Read [`docs/README.md`](docs/README.md).
3. Read every file in [`docs/IMPORTANT/`](docs/IMPORTANT/).

The docs system is intentionally small. `docs/README.md` explains what is startup-critical, what is a runbook, what documents describe current implemented systems, and where active plans live.

## Repo Layout

### `apps/backend`

NestJS application with these high-signal areas:

- `src/modules/` for domain modules such as auth, preferences, permission grants, users, and workflows
- `src/mcp/` for the MCP transport, auth, tool registry, and resources
- `prisma/` for the schema, migrations, and seed data
- `test/integration/` and `test/e2e/` for backend verification

### `apps/web`

Next.js app router frontend with:

- `app/dashboard/` for profile, preferences, schema, permissions, and chat pages
- `app/api/` for server-side web routes
- `lib/` for Apollo/Auth0 integration

### Root Utilities

- `print-repo-structure.sh` prints the current repo tree
- `docker-compose.yml` starts the local backend stack
- `DEVELOPMENT.md` and `QUICK_START.md` exist, but `docs/README.md` is the canonical docs entrypoint

## Common Commands

From the repo root:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
```

Useful targeted commands:

```bash
pnpm --filter backend start:dev
pnpm --filter backend test:unit
pnpm --filter backend test:integration
pnpm --filter backend test:e2e:tests-only
pnpm --filter web dev
```

Prisma-specific commands live in [`docs/useful/PRISMA_COMMANDS.md`](docs/useful/PRISMA_COMMANDS.md).

## Testing

The backend test layers are:

- `src/**/*.spec.ts` for fast unit tests
- `test/integration/**/*.spec.ts` for real-DB integration tests
- `test/e2e/**/*.e2e-spec.ts` for full app/API tests

For backend work, prefer small changes with targeted tests after each step. The test DB helpers and scripts live under `apps/backend/test/` and `apps/backend/package.json`.

## Docs

- [`docs/README.md`](docs/README.md): canonical docs layout
- [`docs/IMPORTANT/`](docs/IMPORTANT/): short startup pack
- [`docs/useful/`](docs/useful/): sanitized runbooks
- [`docs/current/`](docs/current/): canonical docs for implemented systems
- [`docs/plans/active/`](docs/plans/active/): current design and follow-up work
