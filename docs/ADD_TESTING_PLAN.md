# Backend Testing Plan — Best of Both Worlds (Testing Trophy + Option A)

Target: `apps/backend`  
Stack: NestJS, GraphQL, Prisma, Vertex AI, Auth0  
Date: December 2025  
Core choices: **Jest Projects + shared test DB schema (no schema-per-worker)**

This plan keeps the **Testing Trophy** bias (most confidence from real flows) while adding the reliability guardrails from **Option A** (clear layers, env safety, deterministic DB lifecycle, and centralized helpers).

---

## 0) What “best of both worlds” means

### Keep from Testing Trophy
- **Most tests** are high-confidence “API integration” tests:
  - GraphQL/HTTP → resolver/controller → service → Prisma → Postgres
- **Few unit tests**, but high-value:
  - parsing, branching logic, transformations, edge cases

### Keep from Option A (the guardrails)
- **Jest projects** so each layer has different setup/timeouts
- A dedicated `.env.test` loaded **before** Nest modules
- A dedicated **test Postgres** container
- **No schema-per-worker** to keep it simple:
  - DB tests run **serially** (`maxWorkers: 1`)
- Deterministic DB cleanup via a shared helper (truncate + CASCADE)
- Centralized app factory that stubs Auth0/VertexAI consistently

---

## 1) Test layers and conventions

### A) Unit tests (co-located, fast, parallel)
- **Location:** `apps/backend/src/**/**.spec.ts`
- **Purpose:** validate complex logic in isolation
- **Rules:**
  - no DB
  - no Nest app boot
  - no network
  - mock Prisma + external services

Good targets in your repo:
- `preference-extraction.service.ts` and other parsing/extraction logic
- suggestion application / mapping logic
- guards with real branching logic (if present)

---

### B) Integration tests (DB + Nest DI, no HTTP boundary)
- **Location:** `apps/backend/test/integration/**/*.spec.ts`
- **Purpose:** verify Prisma queries/constraints and service/repo behavior with a real DB
- **Rules:**
  - real Postgres + real PrismaService
  - use `TestingModule` (DI wiring), but don’t go through HTTP
  - stub external providers (Auth0/Vertex AI)
- **Runs:** serially (`maxWorkers: 1`)

This layer is faster + easier to debug than full HTTP tests, and is great for repositories (`*.repository.ts`) and transactional service methods.

---

### C) API integration tests (HTTP boundary: GraphQL/REST/MCP + DB)
- **Location:** `apps/backend/test/e2e/**/*.e2e-spec.ts`
- **Purpose:** verify vertical slices end-to-end (main confidence layer)
- **Rules:**
  - boot Nest app
  - use `supertest` against `/graphql` and controllers
  - real DB
  - stub external services
- **Runs:** serially (`maxWorkers: 1`)

Note: these are “E2E” in the practical sense (HTTP boundary), but they’re still deterministic integration tests because you stub external systems.

---

## 2) Jest Projects (monorepo-friendly)

Update `apps/backend/jest.config.js` to define **three projects**:

1. **unit**
   - `testMatch: ['<rootDir>/src/**/*.spec.ts']`
   - fast, parallel

2. **integration**
   - `testMatch: ['<rootDir>/test/integration/**/*.spec.ts']`
   - `maxWorkers: 1`
   - `setupFiles: ['<rootDir>/test/setup/env.ts']` *(dotenv loads `.env.test` early)*
   - `setupFilesAfterEnv: ['<rootDir>/test/setup/jest.after-env.ts']` *(DB reset hooks)*
   - longer timeout than unit

3. **e2e**
   - `testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts']`
   - `maxWorkers: 1`
   - same setup files as integration
   - longest timeout

**Why this is the “best of both worlds”:**
- keeps unit tests quick and parallel
- keeps DB tests stable by running serially
- gives you a place for “DB + DI” tests that don’t need HTTP (integration)
- still supports heavy API integration testing (Testing Trophy)

---

## 3) Test environment safety: `.env.test` loaded early

Add: `apps/backend/.env.test`

Principles:
- `NODE_ENV=test`
- `DATABASE_URL` points to a dedicated test DB (never dev/prod)
- disable/guard external integrations in tests

Add: `apps/backend/test/setup/env.ts` that loads `.env.test` via `dotenv.config()`.

**Important:** env loading should be done via Jest `setupFiles` (runs before imports), not only `setupFilesAfterEnv`.

---

## 4) Test database (Docker) — simple and fast

Add: `apps/backend/docker-compose.test.yml` with a dedicated Postgres container, typically on port `5433`.

Optional (nice): run Postgres with `tmpfs` for speed (RAM-backed storage).  
Tradeoff: uses more RAM; ephemeral (which is usually fine for tests).

---

## 5) DB lifecycle: migrations + deterministic cleanup (Option A compatible)

Because you’re not using schema-per-worker, you must ensure:

1) DB-backed tests are **serial** (`maxWorkers: 1`)
2) Every test starts from a clean state

### Recommended lifecycle
- **Before running tests** (script or CI step):
  - bring up test DB container
  - run Prisma migrations against test DB

- **During tests**:
  - before each test (or each file), truncate tables using a shared helper:
    - query all tables in `public`
    - exclude `_prisma_migrations`
    - `TRUNCATE ... CASCADE`

Add helper: `apps/backend/test/setup/test-db.ts` that exports:
- `resetDb(prisma: PrismaService)`
- optionally `ensureMigrated()` if you want migrations inside Jest (many teams prefer doing migrations in scripts/CI)

Hook cleanup in: `apps/backend/test/setup/jest.after-env.ts`  
- In integration/e2e projects: `beforeEach(async () => resetDb(prisma))`

---

## 6) Shared Nest test harness (keeps tests clean)

Add: `apps/backend/test/setup/test-app.ts`

Responsibilities:
- build a Nest `TestingModule` or full `INestApplication`
- apply global pipes if needed (e.g. `ValidationPipe`)
- stub external providers consistently:
  - `Auth0Service`
  - `VertexAiService`
  - any outbound HTTP client wrappers

Recommended patterns:
- **For most API tests:** bypass auth with an override guard or mock Auth0 validation and inject a known user context.
- **Add a few auth boundary tests**:
  - unauthenticated is rejected
  - wrong role is rejected
  - authenticated succeeds

This gives you strong security regression protection without making every test fight auth.

---

## 7) What to test first (high ROI rollout)

### Milestone 1 — Harness + smoke test
- add `.env.test`
- add `docker-compose.test.yml`
- add test setup helpers (`env.ts`, `test-db.ts`, `test-app.ts`, `jest.after-env.ts`)
- configure Jest projects
- add `test/e2e/health.e2e-spec.ts`

Exit criteria:
- unit tests run
- e2e smoke passes against test DB

---

### Milestone 2 — Core API integration flows (Testing Trophy emphasis)
Add 3–6 tests that match your most important flows:
- preferences CRUD (GraphQL)
- location CRUD (GraphQL)
- MCP endpoint happy path + one auth failure case
- document analysis flow (stub Vertex AI)

---

### Milestone 3 — DB integration coverage (fast + focused)
Add 3–6 tests focused on DB behavior:
- repository CRUD + constraints
- transaction/compound queries
- “external identity” mapping (if central to auth)

---

### Milestone 4 — Targeted unit tests for tricky logic
Add unit tests where they save time:
- parsing/extraction edge cases
- suggestion application mapping logic
- any branching-heavy service code

---

## 8) Scripts (pnpm workspace-friendly)

Add scripts in `apps/backend/package.json`:
- `test` (often defaults to `test:unit`)
- `test:unit` → `jest --selectProjects unit`
- `test:integration` → `jest --selectProjects integration`
- `test:e2e` → `jest --selectProjects e2e`
- `test:cov` → unit-focused coverage

Typical local workflow:
1) `pnpm --filter backend test:unit`
2) `pnpm --filter backend test:integration`
3) `pnpm --filter backend test:e2e`

---

## 9) CI (Cloud Build) wiring

In `cloudbuild.yaml` (or your CI):
1) start test DB (`docker-compose -f apps/backend/docker-compose.test.yml up -d`)
2) run migrations (`prisma migrate deploy` using `.env.test`)
3) run unit tests
4) run integration tests
5) run e2e tests

Because DB tests are serial, runs are stable and predictable.

---

## Final repo structure (after implementation)

Below is the **target structure** for `apps/backend` after applying this plan (showing only relevant additions/changes):

```
apps/backend
├── .env.test
├── docker-compose.test.yml
├── jest.config.js                    # Jest projects: unit + integration + e2e
├── prisma
│   ├── migrations
│   └── schema.prisma
├── src
│   ├── app.module.ts
│   ├── infrastructure
│   │   ├── auth0
│   │   │   └── auth0.service.ts
│   │   ├── prisma
│   │   │   └── prisma.service.ts
│   │   └── vertex-ai
│   │       └── vertex-ai.service.ts
│   └── modules
│       ├── user
│       │   ├── user.service.ts
│       │   └── user.service.spec.ts          # unit (example)
│       └── preferences
│           └── document-analysis
│               ├── preference-extraction.service.ts
│               └── preference-extraction.service.spec.ts  # unit (already exists)
└── test
    ├── setup
    │   ├── env.ts                    # loads .env.test (setupFiles)
    │   ├── test-db.ts                # resetDb (truncate + CASCADE)
    │   ├── test-app.ts               # app factory (stubs Auth0/VertexAI)
    │   └── jest.after-env.ts         # hooks resetDb in DB projects
    ├── integration
    │   ├── user.repository.spec.ts
    │   └── preference.repository.spec.ts
    └── e2e
        ├── health.e2e-spec.ts
        ├── mcp.e2e-spec.ts           # rename from mcp.e2e.spec.ts (recommended)
        └── preferences.e2e-spec.ts
```
