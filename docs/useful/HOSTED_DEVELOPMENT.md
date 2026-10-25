# Hosted And Contributor Development

- Status: retained reference/developer composition, not the installed local app

The hosted root uses NestJS, PostgreSQL/Prisma, Auth0 and Vertex AI. The commands
below intentionally select it. For the local product use the [installed runbook](INSTALLED_MAC_APP.md)
or explicit [local UI](LOCAL_UI.md), [MCP](MCP_LOCAL_SETUP.md) and [identity](LOCAL_IDENTITY_ADMIN.md)
commands. Hosted credentials are not local-product prerequisites. Run shell examples
from the repository root. Check [the workflow](AGENT_WORKFLOW.md) before validation.

## Prerequisites

### Branch And Deployment Ownership

`main` is the local-first development line. Production-hosted fixes originate
on and target `hosted-v1-maintenance`; deliberately forward-port shared fixes
with their consumers/tests. Never wholesale merge these long-lived lines into
one another. Classify changes as local-only, hosted-only or shared before choosing
the target. In particular, the destructive Step 03 main-line identity/schema
transition is **not backportable to hosted production** without a separate
explicit data/compatibility decision.

Vercel's production branch was operator-confirmed as `hosted-v1-maintenance`;
reverify the external configuration before changing branch/deployment roles.
An informational or ignored-build Vercel status does not replace required
GitHub Actions. This reset changes no deployment settings or branch protections.

### Toolchain And Hosted Services

- Node.js 24.21.0 exactly
- pnpm 10.25.0 exactly, activated through Corepack
- Docker with `docker compose`
- Auth0 issuer/audience values for the backend API and Auth0 credentials for the frontend web app
- Optional: Google Cloud application default credentials if you want the
  hosted composition's Vertex AI-backed features to work on your development
  machine

Install dependencies from the repo root:

```bash
nvm install 24.21.0
nvm use 24.21.0
corepack enable
corepack prepare pnpm@10.25.0 --activate
pnpm check:toolchain
pnpm install --frozen-lockfile
```

The tracked `.nvmrc`, strict package metadata, CI, Docker stages, builds, and
migration gate all use this exact pair. Other Node.js 24 patch releases and
other pnpm versions are intentionally unsupported until a reviewed atomic
toolchain update changes every source together.

The checked contributor and gate path currently covers macOS and Linux only.
Windows remains analysis-only: common Corepack/npm pnpm shims are `.cmd` files,
while the version probe deliberately does not start a shell. Use a validated
macOS or Linux environment until native Windows executable resolution and gate
evidence land.

## Hosted Composition Environment Setup

Create the env files the apps expect:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env.local
```

Important backend env notes:

- The backend loads only `apps/backend/.env.local` and then `apps/backend/.env`, regardless of the directory from which it is launched. Existing process environment values win over both files.
- `apps/backend/.env` is also the container-oriented service environment file used by `docker compose`
- `apps/backend/.env.local` is the right place for local-only overrides
- Docker Compose interpolation is separate from the service `env_file`. Copy `docker-compose.env.example` to the root `.env`, or run commands with `docker compose --env-file docker-compose.env.example ...`.
- `PORT` is the backend listener port. Root `APP_PORT` is only the Docker Compose host-publication port that maps to the container's listener.
- Authenticated flows require `AUTH0_ISSUER` and `AUTH0_AUDIENCE` in the backend plus the web app's Auth0 session/client values
- Invite-only login and signup gating is configured in Auth0 Actions; see [`docs/useful/AUTH0_LOGIN_GATING.md`](AUTH0_LOGIN_GATING.md)
- Vertex AI-backed flows need `GCP_PROJECT_ID`, `VERTEX_*`, and usable Google application default credentials
- MCP OAuth flows additionally need `MCP_SERVER_URL` and the relevant `AUTH0_MCP_*` client IDs

Important frontend env notes:

- `apps/web/.env.local` must point `NEXT_PUBLIC_GRAPHQL_URL` (usually `http://localhost:3000/graphql`) and `NEXT_PUBLIC_BACKEND_URL` (usually `http://localhost:3000`) at the backend. Next captures both public values at build time, so rebuild the web app after changing them.
- `APP_BASE_URL` is the Auth0 server-runtime origin and should match the frontend server, usually `http://localhost:3002` in development.

### Hosted Development Database Hostname Rule

Use different `DATABASE_URL` hostnames depending on where the backend runs:

- Backend in Docker: use `postgres` as the hostname
- Backend on your host machine: use `localhost` as the hostname

Example override file for running the hosted backend composition on the host:

```bash
cat > apps/backend/.env.local <<'EOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/context_router?schema=public
PORT=3000
EOF
```

The `localhost` hostname and `?schema=public` query above are for hosted
development only. The explicit PostgreSQL reference preview requires literal
`127.0.0.1`, an explicit port, no URL query, and a verified TLS CA. The default SQLite local command ignores hosted database configuration and requires its two explicit private roots.

### Hosted Vertex AI Note

The root `docker-compose.yml` mounts `~/.config/gcloud/application_default_credentials.json` into the backend container. If you want containerized Vertex AI calls to work, run:

```bash
gcloud auth application-default login
```

## Running The Repo

### Recommended Hosted Development Loop

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

The supported direct backend launch paths are:

```bash
pnpm --filter backend start
pnpm --filter backend start:dev
pnpm --filter backend start:prod
```

The root `pnpm dev` and `pnpm dev:backend` commands delegate to these package
scripts. Docker and Cloud Run inject their process environment before starting
the same hosted entrypoint. The tests and staged runtime harnesses inject an
explicit backend package root and environment so they exercise the same
configuration contract without depending on the caller's working directory.

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

Important: this is not a hot-reload backend workflow. The backend image is built from source, and code changes require rebuilding or restarting the container.

## Hosted Development URLs And Endpoints

- Frontend dashboard: `http://localhost:3002`
- Backend GraphQL API: `http://localhost:3000/graphql`
- Backend health check: `http://localhost:3000/health`
- Document analysis upload endpoint: `POST http://localhost:3000/api/preferences/analysis`
- MCP HTTP endpoint: `POST http://localhost:3000/mcp`

## MCP Client Setup

Copy/paste setup commands for Claude Code and Codex, with both local and Cloud Run remote server entries, live in [`docs/useful/MCP_LOCAL_SETUP.md`](MCP_LOCAL_SETUP.md).

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
pnpm test:web
```

Backend-specific commands:

```bash
pnpm --filter backend prisma:generate
pnpm --filter backend schema:check
pnpm --filter backend schema:generate
pnpm --filter backend test:db:up
pnpm --filter backend test:db:down
pnpm --filter backend test:db:migrate
pnpm --filter backend test:e2e:tests-only
```

`apps/backend/src/schema.gql` is the tracked GraphQL consumer fixture used by
the web code generator and migration contract checks. After changing a GraphQL
resolver or DTO, run `schema:generate` and commit the resulting fixture;
`schema:check` is the read-only drift check. Both commands build the application
schema in memory and resolve the fixture independently of the caller's working
directory. They require installed dependencies and a generated Prisma client,
but do not require a running database or provider credentials.
An intentional SDL change still follows the
[`interface-evolution` policy](INTERFACE_EVOLUTION.md):
review and update affected contract fixtures and consumers in the same change.
Generating the file is not, by itself, approval for a contract change.

More targeted operational commands live in [`docs/useful/PRISMA_COMMANDS.md`](PRISMA_COMMANDS.md).

## Testing

Backend tests live under `apps/backend` and are split into:

- Unit tests for isolated services and utilities
- Integration tests for Prisma and repository behavior against a real test database
- E2E tests for GraphQL, MCP, health, and preference-related flows
- `pnpm --filter backend test:local-database` for file-backed SQLite contracts, actual application/auth/reset, owned process/recovery and matching-pair backup; its build prerequisite needs no `DATABASE_URL` or PostgreSQL setup

The default `pnpm test:backend` (also reached by workspace `pnpm test`) generates the Prisma client and builds the backend once before running all four Jest projects. The dedicated local command has the same prerequisite; unit-only and hosted integration commands remain independently selectable. Default all-project runs still require the configured PostgreSQL test database.

Choose the smallest complete check for the changed behavior during iteration:

| Command | Scope and prerequisites |
| --- | --- |
| `pnpm test:backend:unit` | Unit and contract tests; use Jest `--runTestsByPath` for a known affected file. |
| `pnpm --filter backend test:local-database` | SQLite/worker/process contracts with fresh Prisma generation and backend build. |
| `pnpm --filter backend test:local-database:tests-only` | The same SQLite tests when this checkout's generated client and backend build are already current. Rebuild after relevant source, dependency or configuration changes. |
| `pnpm --filter web test:helpers` | Browser-independent helper tests; no application build or Chromium needed. |
| `pnpm --filter web test:browser` | All authenticated browser suites, including client names; needs current backend/web builds and pinned Chromium. |
| `pnpm test:web` or `pnpm --filter web test:local-ui` | The complete web umbrella, with the browser prerequisites above. |

The focused web groups must form an exact, disjoint census of `test/*.test.mjs`.
Classify a new suite in the `apps/web/package.json` focused scripts; an unclassified, missing or
duplicate file fails focused selection. The umbrella keeps independent glob
discovery. For a specific browser case, pass Node's option, for example
`pnpm --filter web exec node --unhandled-rejections=strict --test --test-concurrency=1 --test-name-pattern='client names' test/client-names.test.mjs`.
Keep Node test options before the filenames; appending them to the focused package
script does not filter its explicit file list.
Focused commands do not replace required final CI or the
[validation policy](AGENT_WORKFLOW.md#default-and-exceptions).

For an advisory starting point, run `pnpm test:plan --base origin/main` (or add
`--json`; use `pnpm --silent test:plan --base origin/main --json` when piping JSON
without pnpm's script banner). It prints focused commands, prerequisites and path-specific reasons;
it does not execute them, fetch refs, build applications or start services.
The default base is the locally available `origin/main`; fetch explicitly when
needed. The output records the resolved base, HEAD and unique merge-base and
unions committed changes since that merge-base, staged, unstaged and untracked
paths. Deleted files and both rename sides remain visible; repository and global
ignore rules are honored. Keep inputs stable during collection and rerun after changes.

The output separates directly relevant checks (`commands` in JSON) from wider
validation candidates (`widerValidation`). The latter are neither derived CI
routing nor automatic local requirements: resolve impacts under the validation
policy, including required local evidence. Small rules reuse the web test groups,
contract registry paths and gate manifest's pre-build Node test list. Registry
membership is not a complete consumer graph. Existing supported sibling tests
and same-name backend specs supply focused starting points; shared, unknown and
boundary inputs still require manual impact review.

Documentation suggestions cover the reviewed CI reader inventory plus further reader
discovery using old/new paths, basenames and asserted content. They are not a
complete dependency graph, and component Markdown retains component checks.
The base-bound contract wrapper needs full history and a 40-character merge-base;
it compares contract inputs but issues no source/package qualification receipt.
The plain contract checker covers only current-tree consistency by default.
Separate committed, staged and unstaged whitespace checks are printed; add intended
untracked files before the staged check can cover them.
The SQLite recommendation owns its generation/build;
the printed tests-only alternative requires independently verified current inputs,
not file existence or timestamps. Invalid refs, conflicts, ambiguous history or
invalid web test census fail without a partial plan. The planner never chooses CI
lanes or declares qualification: apply the validation policy, current scoped plan
and remaining Mac, artifact and manual acceptance obligations.

The migration gate retains a bounded structured report for its `test:local-database`
command. In the GitHub Actions run, open **Artifacts →
local-database-failure-evidence-&lt;run ID&gt;-&lt;attempt&gt;** and download
`local-migration-database-failures.json` (seven-day retention). The job summary's
`databaseTests` and `databaseTestsExport` fields show collection and publication
availability. Artifact transport is optional; its own step shows upload failures.
The required gate keeps its original exit, cancellation and cleanup behavior.
For a local failed/incomplete database command, the gate prints a separate private
temporary report path that survives disposable workspace/diagnostics cleanup.
Delete that report directory after investigating; no automatic local expiry is set.

Report schema version 2 binds the fixed phase/command, caller HEAD (40- or
64-digit Git object ID), copied-input SHA-256, dirty status, random attempt ID and
available CI run/attempt numbers. For pull requests, caller HEAD normally names
GitHub's tested merge commit; use the run's PR head/base to resolve that identity.
Each failure identifies a validated copied-source file, content SHA-256, declaration
line/column, ordinal and fixed matcher/error category. Completed files use the
one-based index in Jest's final result array (including skipped/todo entries), so
retries and duplicate titles do not inflate failures. Interrupted files retain
provisional callback-attempt ordinals; these count delivered callbacks, including
todo but not skipped tests in the pinned Jest version, and can include retries.
They are leads, not final failed-test counts. `suite-error` covers runner-level
file errors, including loading and teardown, without guessing the stage.

`progress` distinguishes a reporter that was not observed, started, or completed,
and lists started files that have not completed. A passing file followed by a hung
file therefore retains the unfinished file's source identity even without an
assertion failure. No validated reporter header means `not-observed`; this cannot
identify which build/configuration/startup step failed before reporting began.
Use the source revision and declaration location to find nested or parameterized
tests. Runtime titles, assertions, expected/actual values, stacks, environment dumps
and raw logs are omitted. Reviewed repository-relative source filenames are
publishable metadata; filenames changed by secret/canary redaction are omitted,
retaining the file ID and content hash. Unknown runtime paths are never published.
This is diagnostic context, not a full assertion transcript or a determination
that a test is flaky. For this command, public gate failure messages refer to the
structured report; arbitrary error text and output tails stay out of the summary
even when the report is unavailable. Private command logs retain their existing
behavior.

The producer and consumer cap wire reports and exported JSON at 64 KiB, wire
records at 512 bytes, published failures at 64, and file tracking/source catalogs
at 128 files. Source paths may contain dots and other valid filename characters,
with a 240-byte bound and no control characters, backslashes or traversal segments.
Source hashing is streamed with a 1 MiB per-file/8 MiB total bound. The producer
records up to 64 provisional and 64 final failures and scans at most 100,000 final
test results. File completion commits its final records; until then, only attempt
leads are published. Capture limits set `truncated`; `counts.exact` distinguishes
fully reconciled final counts from lower bounds, and `suiteErrors` counts Jest
runtime-error suites. An attempt-only limit does not truncate completed final
results. If source-path expansion reaches the JSON budget, excess unfinished-file
entries (then failures) are omitted with explicit truncation and
`progress.omittedInFlightFiles`.

Collection reports `complete`, `partial`, or `unavailable`, separately from
`truncated` and the original `commandResult`. A valid interrupted prefix retains
validated progress and earlier failures; malformed records, wrong bindings and
unsafe/replaced files are rejected. Reporting errors do not turn passing tests
into failures or replace an existing failure. Failed local publication removes
only files/directories with matching owned identities; if cleanup cannot safely
finish, the gate prints the retained private directory and reports that status.
The CI upload accepts only the freshly published exact JSON file, never the
diagnostics directory. Uncatchable termination can prevent final export; the
workflow then records missing evidence. Direct Jest/database commands outside
the migration gate do not enable this reporter.

Test database details:

- `apps/backend/docker-compose.test.yml` starts PostgreSQL on `localhost:5433`
- `pnpm --filter backend test:db:migrate` runs migrations against `context_router_test`
- `pnpm test:backend:e2e` starts the test DB, migrates it, and then runs the e2e suite

CI currently validates:

- Backend unit tests
- Backend integration tests
- Backend e2e tests against the test database
- Standalone local database tests plus the twelve-phase migration gate, including both PostgreSQL reference and SQLite source/relocated-package restart evidence
- Frontend production build and authenticated local dashboard browser coverage

## Docs

[`docs/README.md`](../README.md) explains the docs layout and writing rules. Start there to find the right doc for your task.
