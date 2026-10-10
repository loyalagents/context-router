# Current State

- Status: important
- Read when: startup
- Source of truth: `apps/backend/src/**`, `apps/backend/test/**`, `apps/web/app/dashboard/**`, `README.md`
- Last reviewed: 2026-10-10

## What This Is

A pnpm monorepo with a NestJS backend (`apps/backend/`) and a Next.js frontend
(`apps/web/`). The default hosted root uses PostgreSQL/Prisma, verifies Auth0
JWTs at an edge adapter, calls Vertex AI for AI-backed features, and exposes
HTTP GraphQL, REST, OAuth/DCR, and MCP surfaces.

The explicit `local-database-preview` now uses SQLite through pinned Node 24.21.0 and the default `local-identity` command. It keeps a stable random principal and independent bearer in a separate private identity root, seeds catalog definitions only, and initializes the real local Nest composition without a listener. It needs no PostgreSQL, Docker, Auth0/JWKS or model runtime. The previous `local-identity-preview` remains an explicit PostgreSQL reference command with its own original state. Hosted defaults stay unchanged. Both no-model previews exclude the web app and MCP transport, and both AI ports return a fixed unavailable result. Merged Step 06 adds explicit non-listening `preview-model` with the manually operated selected local adapter; its accepted E/H limitations remain. Merged Step 07 adds separately selected `local-mcp serve` / `serve-model`: narrow loopback HTTP, explicit preserving SQLite v2 upgrade, independent MCP credentials, shared services/model ownership and real-guard tests. Its [closeout](../plans/active/local-migration/07-local-mcp/README.md) records final CI and acceptance limits, including inconclusive live server/native cancellation. Step 08 is human-merged; see its [closeout](../plans/active/local-migration/08-local-ui/README.md). The separately selected local dashboard now uses a single-use unlock and independent browser session, with the same SQLite principal/services/model owner as MCP. Hosted authentication remains in the hosted launch. See [local dashboard setup](../useful/LOCAL_UI.md); all four independent review mandates and the full local gate passed; user-run acceptance is complete with explicitly accepted evidence limits recorded in the [acceptance disposition](../plans/active/local-migration/08-local-ui/acceptance.md). [PR #167](https://github.com/loyalagents/context-router/pull/167) merged at `7328ceea63a784577594d52af18062be8b583855` from the verified CI-tested head. Step 09 is now the sole primary migration step on `codex/local-migration-09-installation-and-packaging`, after its [passing clean-base gate](../plans/active/local-migration/09-installation-and-packaging/activation.md). Measured feasibility and all independent [P2.3 plan](../plans/active/local-migration/09-installation-and-packaging/plan.md) reviews passed. The unsigned native menu/guardian candidate, installed CLI, pinned downloader and inherited storage admission are implemented. Candidate 13 passed fresh complete-diff reviews, actual installed bundle qualification, all 180 native tests and one separately approved bounded live-model series. The manual feedback round is complete. All 12 local gate phases passed with clean cleanup; exact-head CI results are recorded on draft [PR #168](https://github.com/loyalagents/context-router/pull/168); the [acceptance disposition](../plans/active/local-migration/09-installation-and-packaging/acceptance.md) retains unqualified recovery, hardware/platform and signing/distribution limits. See the [installed Mac runbook](../useful/INSTALLED_MAC_APP.md). [UI usability improvements](../plans/active/ui-usability/README.md) are deferred until the packaged local workflow is usable. See [local identity administration](../useful/LOCAL_IDENTITY_ADMIN.md) for roots, recovery, backup constraints and reference commands.

Run `./print-repo-structure.sh` for the full layout. See `README.md` for setup and dev workflows.

## Implemented Systems

- GraphQL and hosted MCP share a provider-neutral verified-human identity
  resolver keyed by the exact `(provider, issuer, subject)` tuple;
  within backend human-identity resolution, Auth0-specific code is limited to
  JWT/JWKS validation and claim adaptation. The web app still owns its Auth0
  SDK/session integration. Email is a non-authoritative, non-unique profile
  hint and is never an identity-link key. The main-line Step 03 migration
  intentionally deletes historical user-owned data instead of translating it.
- Preference definitions are stored in the database, with global and user-owned namespaces, archive support, GraphQL mutations, and an MCP tool for creating user definitions.
- User preferences support active and suggested states, location-scoped values, and AI-backed document analysis for extracting suggestions from uploaded files.
- Hosted MCP retains HTTP transport, OAuth/DCR, registry, schema resource, grants and workflow tools. Local MCP reuses the tools/services with its own fresh SQLite credential guard and bounded sessions, excludes OAuth/DCR, and adds a local capability resource. Empty or unrecognized hosted scopes now deny explicitly.
- Permission grants narrow MCP access per client key and slug target. The web dashboard includes a permissions page for testing and managing grants.
- The workflow layer currently powers `smartSearchPreferences` and `consolidateSchema`.
- The web app has dashboard pages for profile, preferences, schema, permissions, and chat.

## Where To Look Next

- Live repo layout: run `./print-repo-structure.sh`
- Runbooks: `docs/useful/`
- Implemented-system docs: `docs/current/`
- Active follow-up work: `docs/plans/active/`
- Local-first migration control plane:
  `docs/plans/active/local-migration/orchestration.md`
