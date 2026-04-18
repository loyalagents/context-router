# Repo Map

- Status: important
- Read when: startup
- Source of truth: `apps/backend/**`, `apps/web/**`, `package.json`, `apps/backend/package.json`, `apps/web/package.json`
- Last reviewed: 2026-04-18

## Top Level

- `apps/backend/`: NestJS backend, Prisma schema/migrations, MCP, GraphQL, tests
- `apps/web/`: Next.js frontend and dashboard pages
- `docs/`: canonical docs tree
- `print-repo-structure.sh`: current tree printer

## Backend Hotspots

- `apps/backend/src/modules/`: business modules such as auth, preferences, permission grants, users, and workflows
- `apps/backend/src/mcp/`: MCP controller, auth, tool registry, resources, and transport policy
- `apps/backend/prisma/`: schema, migrations, seed data
- `apps/backend/test/integration/` and `apps/backend/test/e2e/`: real verification paths

## Frontend Hotspots

- `apps/web/app/dashboard/`: product and testing pages for profile, preferences, schema, permissions, and chat
- `apps/web/app/api/`: server routes
- `apps/web/lib/`: Apollo and Auth0 wiring

## Source-of-Truth Rule

- Behavior lives in code and tests.
- Docs should explain why a system exists, how it fits together, and where to look next.
- If a doc disagrees with code or tests, trust code and tests.
