# Context Router

Context Router is a `pnpm` workspace monorepo with:

- `apps/backend`: a NestJS backend that exposes GraphQL, a document-analysis upload API, health checks, and an Auth0-protected MCP HTTP endpoint.
- `apps/web`: a Next.js 15 dashboard that authenticates with Auth0 and talks to the backend with bearer tokens.
- PostgreSQL via Prisma for application data, plus a separate Docker-backed test database for integration and e2e coverage.

## How The Repo Works

The main request flow looks like this:

1. A user signs into the Next.js app through Auth0.
2. The frontend fetches an access token and calls the backend GraphQL API or the document upload endpoint.
3. The backend validates the token, reads and writes data through Prisma/PostgreSQL, and calls Vertex AI for AI-assisted flows.
4. External MCP clients can also talk to the backend over `POST /mcp` using the repo's Auth0-backed MCP OAuth/JWT setup.

Major product areas currently in the repo:

- Account/profile management
- Preferences and preference definitions
- Location-scoped preferences
- Permission grants
- Document analysis and AI-generated preference suggestions
- Preference schema/search workflows
- MCP tools and resources for preference access

## Repo Layout

```text
.
├── apps
│   ├── backend   # NestJS + GraphQL + Prisma + MCP
│   └── web       # Next.js dashboard
├── docs          # design notes, plans, and MCP references
├── docker-compose.yml
├── DEVELOPMENT.md
├── QUICK_START.md
└── print-repo-structure.sh
```

Key backend areas:

- `apps/backend/src/modules`: domain modules such as auth, preferences, permission grants, user, and workflows
- `apps/backend/src/mcp`: MCP transport, auth, tools, and resources
- `apps/backend/prisma`: schema, migrations, and seed script
- `apps/backend/test`: unit, integration, and e2e test suites

Key frontend areas:

- `apps/web/app/dashboard`: authenticated dashboard pages for profile, preferences, schema, permissions, and chat
- `apps/web/app/api`: Next.js route handlers that proxy authenticated actions to the backend
- `apps/web/lib`: Auth0 and Apollo client setup

## Prerequisites

- Node.js 20+
- `pnpm` via Corepack
- Docker with `docker compose`
- Auth0 credentials for the backend API and frontend web app
- Optional: Google Cloud application default credentials if you want Vertex AI-backed features to work locally

Install dependencies from the repo root:

```bash
corepack enable
pnpm install
```

## Environment Setup

Create the env files the apps expect:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env.local
```

Important backend env notes:

- `apps/backend/.env` is the container-oriented baseline file used by `docker compose`.
- The Nest app loads `.env.local` before `.env`, so `apps/backend/.env.local` is the right place for local-only overrides.
- Authenticated flows require valid `AUTH0_*` values in both apps.
- Vertex AI-backed flows need `GCP_PROJECT_ID`, `VERTEX_*`, and usable Google application default credentials.
- MCP OAuth flows additionally need `MCP_SERVER_URL` and the relevant `AUTH0_MCP_*` client IDs.

Important frontend env notes:

- `apps/web/.env.local` must point `NEXT_PUBLIC_GRAPHQL_URL` at the backend, usually `http://localhost:3000/graphql`.
- `APP_BASE_URL` should match the frontend dev server, usually `http://localhost:3002`.

### Database Hostname Rule

Use different `DATABASE_URL` hostnames depending on where the backend runs:

- Backend in Docker: use `postgres` as the hostname
- Backend on your host machine: use `localhost` as the hostname

Example local override file for host-based backend development:

```bash
cat > apps/backend/.env.local <<'EOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/context_router?schema=public
PORT=3000
EOF
```

### Vertex AI Note

The root `docker-compose.yml` mounts `~/.config/gcloud/application_default_credentials.json` into the backend container. If you want containerized Vertex AI calls to work, run:

```bash
gcloud auth application-default login
```

## Running The Repo

### Recommended Local Development Loop

This is the best workflow if you are actively changing backend code and want hot reload:

1. Start only PostgreSQL in Docker:
   ```bash
   docker compose up -d postgres
   ```
2. Make sure `apps/backend/.env.local` points `DATABASE_URL` at `localhost`.
3. Run Prisma migrations from the repo root:
   ```bash
   pnpm --filter backend exec prisma migrate dev
   ```
4. Start the backend:
   ```bash
   pnpm dev:backend
   ```
5. In another terminal, start the frontend:
   ```bash
   pnpm dev:web
   ```

You can also run both apps locally with:

```bash
pnpm dev
```

That still assumes your backend is using a host-based `DATABASE_URL`, not the Docker hostname.

### Containerized Backend Workflow

Use this if you want the backend to run inside Docker instead of on the host:

1. Keep `apps/backend/.env` using `postgres` as the database hostname.
2. Start the backend and database:
   ```bash
   docker compose up -d postgres app
   ```
3. Run migrations inside the container:
   ```bash
   docker compose exec app npx prisma migrate dev
   ```
4. Start the frontend locally:
   ```bash
   pnpm dev:web
   ```

Important: this is not a hot-reload backend workflow. The backend image is built from source, and code changes require rebuilding/restarting the container.

## Local URLs And Endpoints

- Frontend dashboard: `http://localhost:3002`
- Backend GraphQL API: `http://localhost:3000/graphql`
- Backend health check: `http://localhost:3000/health`
- Document analysis upload endpoint: `POST http://localhost:3000/api/preferences/analysis`
- MCP HTTP endpoint: `POST http://localhost:3000/mcp`

## Common Commands

From the repo root:

```bash
pnpm dev
pnpm dev:backend
pnpm dev:web
pnpm build
pnpm build:backend
pnpm build:web
pnpm test:backend
pnpm test:backend:unit
pnpm test:backend:integration
pnpm test:backend:e2e
```

Backend-specific commands:

```bash
pnpm --filter backend prisma:generate
pnpm --filter backend test:db:up
pnpm --filter backend test:db:down
pnpm --filter backend test:db:migrate
pnpm --filter backend test:e2e:tests-only
```

## Testing

Backend tests live under `apps/backend` and are split into:

- Unit tests for isolated services and utilities
- Integration tests for Prisma/repository behavior against a real test database
- E2E tests for GraphQL, MCP, health, and preference-related flows

Test database details:

- `apps/backend/docker-compose.test.yml` starts PostgreSQL on `localhost:5433`
- `pnpm --filter backend test:db:migrate` runs migrations against `context_router_test`
- `pnpm test:backend:e2e` starts the test DB, migrates it, and then runs the e2e suite

CI currently validates:

- Backend unit tests
- Backend integration tests
- Backend e2e tests against the test database
- Frontend production build

## Related Docs

Use `README.md` as the entry point for setup and day-to-day commands. Other markdown files in the repo are mostly deeper design notes, plans, or feature-specific references, especially:

- `DEVELOPMENT.md`
- `QUICK_START.md`
- `docs/MCP_INTEGRATION.md`
- `docs/mcp-connections.md`
- `docs/workflows/`
