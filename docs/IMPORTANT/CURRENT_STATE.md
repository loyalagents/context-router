# Current State

- Status: important
- Read when: startup
- Source of truth: `apps/backend/src/**`, `apps/backend/test/**`, `apps/web/app/dashboard/**`, `README.md`
- Last reviewed: 2026-09-22

## What This Is

A pnpm monorepo with a NestJS backend (`apps/backend/`) and a Next.js frontend (`apps/web/`). PostgreSQL via Prisma. Auth0 is the current hosted token provider, behind a provider-neutral principal resolver. Vertex AI powers AI-backed features. The backend exposes both GraphQL and an MCP HTTP endpoint.

Run `./print-repo-structure.sh` for the full layout. See `README.md` for setup and dev workflows.

## Implemented Systems

- GraphQL and MCP share a provider-neutral verified-human identity resolver keyed by `(provider, issuer, subject)`; Auth0-specific code is limited to JWT/JWKS validation and claim adaptation. Email is a non-authoritative, non-unique profile hint.
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
