# Context Router

A local-first preference/context application: import documents, review suggested
preferences, manage scoped access, and share context with MCP clients. The managed
Apple Silicon Mac candidate runs its database, dashboard and selected model locally.

The migration foundation and assisted install kit are delivered.
**Assisted pilot acceptance is active.** The integrated `674750a` app passed its
automated artifact checks. On October 29 the user confirmed full demo setup,
including Claude Code 2.1.299, Claude Desktop and Codex connections in demo mode.
See the [current delivery and acceptance record](docs/plans/active/colleague-pilot/assisted-alpha.md#current-delivery-and-demo-acceptance-2026-10-29).
Personal-mode onboarding and remaining live-use/distribution checks are separate;
this is not a qualified general release. See
[current support and limitations](docs/current/LOCAL_APPLICATION.md).

## Use Or Work On The App

- [Installed Mac runbook](docs/useful/INSTALLED_MAC_APP.md): menu, model download,
  unlock, installed CLI, restart, backup/restore and removal. The current candidate
  has no Developer ID or notarization; broader hardware and distribution still need qualification.
- [Local dashboard](docs/useful/LOCAL_UI.md) and [MCP setup](docs/useful/MCP_LOCAL_SETUP.md):
  explicit manual/developer paths. Local MCP uses `http://127.0.0.1:8787/mcp`;
  the installed dashboard opens at its current loopback address.
- [Work portfolio](docs/plans/README.md): colleague pilot, parallel stabilization,
  wanted future features. Active briefs are not blanket implementation approval.
- [Contributor/hosted development](docs/useful/HOSTED_DEVELOPMENT.md): exact
  toolchain, environment, commands and testing. **`pnpm dev` still starts the
  retained hosted composition**, not the installed local application.

## Architecture

- `apps/backend`: NestJS application services, GraphQL `/graphql`, MCP and
  storage/model/identity adapters. Local SQLite and retained PostgreSQL reference
  paths share application-owned persistence boundaries.
- `apps/web`: existing Next.js dashboard with separately selected local browser
  sessions or hosted Auth0 integration.
- `apps/desktop`: native Mac menu/guardian, managed inference lifecycle and
  installed-app packaging.
- `apps/local-orchestrator`, `examples/eval*`: developer/evaluation tooling,
  not bundled product dependencies.

The dashboard and MCP share data and domain services but use separate credentials.
Local inference has no silent hosted fallback. Cloud-backed MCP assistants may
send tool results to their providers; local storage is not a claim that those
assistants operate offline.

## Contributor Start

Read [AGENTS.md](AGENTS.md), run `./print-repo-structure.sh`, then read the short
[Current State](docs/IMPORTANT/CURRENT_STATE.md) and [Docs Guide](docs/README.md).
Use the task's current brief and [agent workflow](docs/useful/AGENT_WORKFLOW.md);
obsolete numbered migration plans are historical, not current instructions.

Use **Node 24.21.0 and pnpm 10.25.0 exactly**:

```sh
nvm install 24.21.0
nvm use 24.21.0
corepack enable
corepack prepare pnpm@10.25.0 --activate
pnpm check:toolchain
pnpm install --frozen-lockfile
```

Backend behavior changes are tests first. Validate affected behavior during
iteration, then qualify a frozen candidate under the
[policy for focused local checks and CI](docs/useful/AGENT_WORKFLOW.md#default-and-exceptions).
The full `pnpm migration:gate` command remains available for its stated exceptions;
contract fixtures and CI remain in force despite the completed program.
See [scoped closeout/evidence](docs/current/LOCAL_MIGRATION_CLOSEOUT.md).
