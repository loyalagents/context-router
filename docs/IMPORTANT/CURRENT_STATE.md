# Current State

- Status: important
- Read when: startup
- Source of truth: `apps/backend/src/**`, `apps/backend/test/**`, `apps/web/app/dashboard/**`, `README.md`
- Last reviewed: 2026-10-03

## What This Is

A pnpm monorepo with a NestJS backend (`apps/backend/`) and a Next.js frontend
(`apps/web/`). The default hosted root uses PostgreSQL/Prisma, verifies Auth0
JWTs at an edge adapter, calls Vertex AI for AI-backed features, and exposes
HTTP GraphQL, REST, OAuth/DCR, and MCP surfaces.

The explicit `local-database-preview` now uses SQLite through pinned Node 24.21.0 and the default `local-identity` command. It keeps a stable random principal and independent bearer in a separate private identity root, seeds catalog definitions only, and initializes the real local Nest composition without a listener. It needs no PostgreSQL, Docker, Auth0/JWKS or model runtime. The previous `local-identity-preview` remains an explicit PostgreSQL reference command with its own original state. Hosted defaults stay unchanged. Both no-model previews exclude the web app and MCP transport, and both AI ports return a fixed unavailable result. Merged Step 06 adds explicit non-listening `preview-model` with the manually operated selected local adapter; its accepted E/H limitations remain. Step 07 adds separately selected `local-mcp serve` / `serve-model`: narrow loopback HTTP, explicit preserving SQLite v2 upgrade, independent MCP credentials, shared services/model ownership and real-guard tests. User-run acceptance for `d7e9d65` is recorded in PR #166, including inconclusive server/native cancellation. Session-recovery follow-up fixes are under renewed validation/review; Step 07 is not complete or merged. See [local identity administration](../useful/LOCAL_IDENTITY_ADMIN.md) for roots, recovery, backup constraints and reference commands.

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
