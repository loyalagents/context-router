# Current State

- Status: important
- Read when: startup
- Source of truth: `apps/backend/src/**`, `apps/backend/test/**`, `apps/web/app/dashboard/**`, `README.md`
- Last reviewed: 2026-09-23

## What This Is

A pnpm monorepo with a NestJS backend (`apps/backend/`) and a Next.js frontend
(`apps/web/`). The default hosted root uses PostgreSQL/Prisma, verifies Auth0
JWTs at an edge adapter, calls Vertex AI for AI-backed features, and exposes
HTTP GraphQL, REST, OAuth/DCR, and MCP surfaces.

The explicit `local-database-preview` now uses SQLite through pinned Node 24.21.0 and the default `local-identity` command. It keeps a stable random principal and independent bearer in a separate private identity root, seeds catalog definitions only, and initializes the real local Nest composition without a listener. It needs no PostgreSQL, Docker, Auth0/JWKS or model runtime. The previous `local-identity-preview` remains an explicit PostgreSQL reference command with its own original state. Hosted defaults stay unchanged. Both previews exclude the web app and MCP transport, and both AI ports return a fixed unavailable result. See [local identity administration](../useful/LOCAL_IDENTITY_ADMIN.md) for roots, recovery, backup constraints and reference commands.

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
- MCP is a first-class backend surface with HTTP transport, OAuth metadata, a DCR shim, a tool registry, a GraphQL schema resource, permission grants, and workflow-backed tools.
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
