# Context Router

A local-first preference/context application: import documents, review suggested
preferences, manage scoped access, and share context with MCP clients. The managed
Apple Silicon Mac candidate runs its database, dashboard and selected model locally.

The migration foundation is delivered. **Assisted pilot qualification is active.**
Claude Code/Codex CLI have scoped local evidence.
Claude Desktop's standalone bridge has passed the main client checks; its live
controlled uncertain-mutation follow-up passed. Whole-app sealing is repaired;
artifact D passed installed, replacement and packaged UI checks, with scoped
Safari launch evidence and full validation on its source. Downloaded-menu cleanup
and Ready/dashboard acceptance remain open; see the
[current pilot results](docs/plans/active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12).
ChatGPT desktop follows; this is not a qualified general release.
See [current support and limitations](docs/current/LOCAL_APPLICATION.md).

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
