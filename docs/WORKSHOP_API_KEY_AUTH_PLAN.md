# Plan: Switch from Auth0 to API Key Authentication (Workshop Branch)

## Context

For the Gates workshop, multiple groups need to connect their systems to this backend. Each group gets an API key that grants access to a pool of users. This replaces Auth0 JWT authentication on the `gates-workshop-2026` branch, keeping `main` untouched. The API key approach is simpler to distribute and doesn't require participants to set up Auth0 accounts.

**Core rule:** The API key always goes in `Authorization: Bearer <apiKey>`. User selection (non-secret routing info) is carried in the most ergonomic place per client type:

1. **Primary (GraphQL/REST/custom HTTP):** `X-User-Id` header
2. **MCP fallback (clients that can't set custom headers):** `?asUser=<userId>` query parameter
3. **Last resort (single-token-field clients):** Compound `Bearer <apiKey>.<userId>` token

The guard resolves userId in order: header → query param → compound token parse. Then validates the key, verifies the user belongs to that key's group, and attaches the user to `req.user`.

**Branch strategy:** All workshop auth changes live on the `gates-workshop-2026` branch. Shared feature work goes to `main` and gets merged into the workshop branch. After the workshop, stop using the branch — nothing to revert on `main`.

---

## Step 1: Update Prisma Schema

**Modify** `apps/backend/prisma/schema.prisma`

- Remove the `ExternalIdentity` model (lines 27-42)
- Remove `externalIdentities` relation from `User` model (line 20)
- Add `ApiKey` and `ApiKeyUser` models:

```prisma
model ApiKey {
  id        String       @id @default(uuid())
  keyHash   String       @unique @map("key_hash")  // SHA-256 hash of the API key
  groupName String       @map("group_name")
  isActive  Boolean      @default(true) @map("is_active")
  createdAt DateTime     @default(now()) @map("created_at")
  updatedAt DateTime     @updatedAt @map("updated_at")
  users     ApiKeyUser[]
  @@map("api_keys")
}

model ApiKeyUser {
  id        String   @id @default(uuid())
  apiKeyId  String   @map("api_key_id")
  userId    String   @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")
  apiKey    ApiKey   @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [userId], onDelete: Cascade)
  @@unique([apiKeyId, userId])
  @@index([apiKeyId])
  @@index([userId])
  @@map("api_key_users")
}
```

- Add `apiKeyUsers ApiKeyUser[]` relation to `User` model
- Run `npx prisma migrate dev --name workshop_api_key_auth`

---

## Step 2: Create API Key Auth Infrastructure (new files)

**Create** `apps/backend/src/modules/auth/api-key.service.ts`
- `validateApiKeyAndUser(apiKey, userId)` — hashes the incoming key with SHA-256, looks up by `keyHash` in DB, verifies user belongs to it, returns User
- `validateApiKey(apiKey)` — validates key alone (for future user-creation scenarios)
- Uses PrismaService directly
- Hashing: `crypto.createHash('sha256').update(apiKey).digest('hex')`

**Create** `apps/backend/src/common/guards/api-key.guard.ts`
- Single guard replacing `GqlAuthGuard`, `JwtAuthGuard`, and `McpAuthGuard`
- Inject NestJS `Reflector` to check for `@Public()` decorator — if route is marked public, skip auth
- Detect context type (GraphQL vs HTTP) to extract the request object
- Resolve API key from `Authorization: Bearer <token>` header
- Resolve userId with three-tier fallback:
  1. `X-User-Id` header (primary — for GraphQL/REST/custom HTTP clients)
  2. `?asUser=` query parameter (fallback — for MCP clients that can only configure a URL)
  3. Parse compound token `<apiKey>.<userId>` from Bearer value (last resort — for clients with only a single token field)
- Call `ApiKeyService.validateApiKeyAndUser(apiKey, userId)`
- Set `request.user` to the Prisma User object (same shape as current guards, so `@CurrentUser()` works unchanged)
- Never put the API key in the URL — only the userId (non-secret routing info) goes in query params
- **Compound token parsing robustness:** Split from the right (`lastIndexOf('.')`) so unexpected dots don't break parsing. API keys are also validated to contain only `[a-zA-Z0-9_-]` characters (no dots) — enforced in the seed script — making the `.` separator unambiguous.

**Error logging:** The guard and service must produce clear, actionable error messages for every failure case. Use NestJS `Logger` to log at `warn` level with context:
- `[ApiKeyGuard] Missing Authorization header` — no Bearer token sent
- `[ApiKeyGuard] Authorization header is not Bearer format` — wrong auth scheme
- `[ApiKeyGuard] No userId resolved (checked: X-User-Id header, ?asUser param, compound token)` — none of the three methods provided a userId
- `[ApiKeyService] API key not found (key prefix: "grp-a-3f...")` — log first 8 chars of the plaintext key for debugging (keys are generated with a human-readable group prefix like `grp-a-`), never log full key
- `[ApiKeyService] API key is inactive (group: "Group A")` — key was revoked
- `[ApiKeyService] User <userId> is not associated with API key group "Group A"` — userId doesn't belong to this key's group
- `[ApiKeyService] User <userId> not found in database` — userId doesn't exist at all
- `[ApiKeyGuard] Auth successful: user <email> via API key group "Group A" (resolved userId from: header|query|compound)` — log at `debug` level on success, include which resolution method was used

All errors should return appropriate HTTP status codes (401 for auth failures, 403 for authorization failures) with a JSON body containing a human-readable `message` field.

---

## Step 3: Swap Guards in All Resolvers/Controllers

Change `@UseGuards(GqlAuthGuard)` to `@UseGuards(ApiKeyGuard)` in:
- `src/modules/auth/auth.resolver.ts`
- `src/modules/user/user.resolver.ts`
- `src/modules/preferences/preference/preference.resolver.ts`
- `src/modules/preferences/location/location.resolver.ts`
- `src/modules/preferences/document-analysis/document-analysis.resolver.ts`
- `src/modules/vertex-ai/vertex-ai.resolver.ts`

Change `@UseGuards(JwtAuthGuard)` to `@UseGuards(ApiKeyGuard)` in:
- `src/modules/preferences/document-analysis/document-analysis.controller.ts`

Change `@UseGuards(McpAuthGuard)` to `@UseGuards(ApiKeyGuard)` in:
- `src/mcp/mcp.controller.ts`

---

## Step 4: Rewire Auth Module

**Rewrite** `src/modules/auth/auth.module.ts`
- Remove: `PassportModule`, `JwtStrategy`, `AuthService`, `ExternalIdentityModule`
- Add: `ApiKeyService`, `ApiKeyGuard`
- Make `@Global()` so the guard is injectable everywhere
- Export: `ApiKeyService`, `ApiKeyGuard`

---

## Step 5: Delete Auth0 Code

**Delete files (15 files):**
- `src/modules/auth/auth.service.ts` — Auth0 JWT validation/user sync
- `src/modules/auth/strategies/jwt.strategy.ts` — Passport JWT strategy
- `src/infrastructure/auth0/auth0.module.ts` — Auth0 management client module
- `src/infrastructure/auth0/auth0.service.ts` — Auth0 API client
- `src/modules/external-identity/` — entire directory (module, service, repository, model)
- `src/common/guards/gql-auth.guard.ts` — old GraphQL JWT guard
- `src/common/guards/jwt-auth.guard.ts` — old REST JWT guard
- `src/common/guards/optional-gql-auth.guard.ts` — old optional auth guard
- `src/mcp/auth/mcp-auth.guard.ts` — old MCP JWT guard
- `src/mcp/auth/oauth-metadata.controller.ts` — OAuth discovery endpoints
- `src/mcp/auth/dcr-shim.controller.ts` — Dynamic Client Registration
- `src/mcp/auth/dcr-rate-limit.guard.ts` — DCR rate limiter

**Update** `src/app.module.ts`
- Remove `Auth0Module` import (line 16, 59)
- Remove `authConfig` from config load array (line 10, 31)

**Update** `src/mcp/mcp.module.ts`
- Remove `OAuthMetadataController`, `DcrShimController` from controllers
- Remove `DcrRateLimitGuard`, `McpAuthGuard` from providers

**Simplify** `src/config/auth.config.ts` — gut Auth0 config, keep as stub or delete

**Simplify** `src/config/mcp.config.ts` — remove the `oauth` section (Auth0 endpoints, scopes, redirect URIs, rate limits)

---

## Step 6: Update CORS and Environment Files

**Modify** `src/main.ts`
- Add `'X-User-Id'` to `allowedHeaders` array (line 31-38)

**Update** `.env.example` — remove Auth0 vars, document API key approach

**Update** `.env.test` — remove Auth0 vars

**Update local `.env` / `.env.local`** (not committed)
- Remove all `AUTH0_*` vars (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_ISSUER`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_MANAGEMENT_API_AUDIENCE`, `AUTH0_SYNC_STRATEGY`, `AUTH0_MCP_PUBLIC_CLIENT_ID`)
- Remove `MCP_RESOURCE`, `MCP_OAUTH_REGISTER_RATE_LIMIT`
- Keep: `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `GRAPHQL_PLAYGROUND`, `GRAPHQL_DEBUG`, `GCP_PROJECT_ID`, `VERTEX_REGION`, `VERTEX_MODEL_ID`, `MCP_SERVER_URL`
- No new auth-related env vars needed — API keys live in the database

**Update `cloudrun.env`** (not committed, used for Cloud Run deployment)
- Same removals as local `.env` above
- Make sure `DATABASE_URL` points to the Cloud SQL instance
- Make sure `MCP_SERVER_URL` is set to the Cloud Run service URL
- Make sure `CORS_ORIGIN` includes the workshop Vercel frontend URL
- Save a backup of the current production `cloudrun.env` before modifying (e.g., `cp cloudrun.env cloudrun.env.production-backup`) so you can restore it after the workshop

**When to do this:** After all code changes are done (Steps 1-5) and before local testing or deployment. The app won't start correctly with Auth0 vars still referenced if the Auth0 modules have been removed.

---

## Step 7: Create Workshop Seed Script

**Rewrite** `prisma/seed.ts`
- Generate plaintext API keys with a human-readable prefix: `grp-a-<random hex>`, `grp-b-<random hex>`
- Hash each key with SHA-256 before storing in DB (`keyHash` column)
- Print the **plaintext** keys and user IDs to console — this is the only time they're visible
- Create 2+ workshop groups, 3 users per group
- Link users to their group's API key via ApiKeyUser

```typescript
import { createHash, randomBytes } from 'crypto';

function generateApiKey(prefix: string): string {
  const key = `${prefix}-${randomBytes(16).toString('hex')}`;
  // Enforce: keys must match [a-zA-Z0-9_-]+ (no dots) so compound token parsing is unambiguous
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error(`Invalid key format: ${key}`);
  return key;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// In seed:
const plaintextKey = generateApiKey('grp-a');
await prisma.apiKey.create({
  data: { keyHash: hashKey(plaintextKey), groupName: 'Group A' },
});
console.log(`Group A API key: ${plaintextKey}`);  // Only time plaintext is visible
```

---

## Step 8: Update Test Infrastructure

**Modify** `test/setup/test-app.ts`
- Replace `GqlAuthGuard`/`JwtAuthGuard` imports with `ApiKeyGuard`
- Replace both `.overrideGuard()` calls with single `ApiKeyGuard` override
- Remove `Auth0Service` mock and its import
- Remove `auth0` from returned `mocks` object
- The mock guard logic itself doesn't change (it already sets `req.user`)

**No other test files need changes** — all e2e tests (`health`, `locations`, `preferences`, `document-analysis`, `mcp`) and integration tests (`user.repository`, `preference.repository`) go through the `createTestApp` factory and don't reference auth directly. There are no existing unit tests for the old auth layer.

**Add new test** `src/modules/auth/api-key.service.spec.ts` (unit test)
- Test cases: valid key + valid user returns user, invalid key throws 401, valid key + user not in group throws 401, inactive key throws 401, missing key/userId throws 401
- Mocks PrismaService to avoid DB dependency

---

## Step 9: Remove Unused Dependencies

**Modify** `apps/backend/package.json` — remove:
- `auth0`, `jwks-rsa`, `passport`, `passport-jwt`, `@nestjs/passport`
- `@types/passport-jwt` from devDependencies

Run `pnpm install` after.

---

## Step 10: Update Frontend (apps/web)

**Remove Auth0 integration:**
- Delete or gut `apps/web/lib/auth0.ts` (Auth0 client setup)
- **Delete the `<UserProvider>` wrapper** from `apps/web/app/layout.tsx` — Auth0's `@auth0/nextjs-auth0` wraps the app tree in `<UserProvider>`. If this isn't removed, the Next.js build will fail immediately after removing the package.
- Update `apps/web/middleware.ts` — remove Auth0 middleware wrapper
- Remove `@auth0/nextjs-auth0` dependency from `apps/web/package.json`
- Remove Auth0 env vars from `apps/web/.env.local` (`AUTH0_SECRET`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`)

**Add connect UI:**
- Rewrite `apps/web/app/page.tsx` — create a simple landing page where attendees:
  1. Paste their group's API key
  2. Select or enter their User ID
  3. Store both in local storage
  4. Get redirected to the dashboard

**Update Apollo Client (SSR-safe):**
- **Important:** `localStorage` is not available during SSR/server components. The Apollo client must be created in a `'use client'` boundary.
- Use a `setContext` link to inject headers **at request time** (not at initialization), since attendees paste credentials after the page loads:
  ```typescript
  // In a 'use client' component/provider
  const authLink = setContext((_, { headers }) => ({
    headers: {
      ...headers,
      authorization: `Bearer ${localStorage.getItem('workshopApiKey')}`,
      'x-user-id': localStorage.getItem('workshopUserId') || '',
    },
  }));
  ```
- Use lowercase header keys (`authorization`, `x-user-id`) — HTTP headers are case-insensitive per spec, but lowercase is slightly safer with strict middleware.

**Update dashboard pages:**
- Remove any Auth0 session checks (`auth0.getSession()`)
- Read user context from local storage or a simple React context provider

---

## Step 11: Wiping Data for Testing / Workshop Reset

To clear all existing users and start fresh (e.g., before seeding workshop data, or resetting between workshop sessions):

**Option A: Full wipe via Prisma (recommended for local dev)**
```bash
cd apps/backend
npx prisma migrate reset --force
```
This drops all tables, re-runs all migrations, and re-runs the seed script. You get a clean DB with fresh workshop groups/users/keys.

**Option B: Selective wipe via SQL (for deployed environments)**
```sql
-- CASCADE handles foreign key ordering
TRUNCATE api_key_users, api_keys, user_preferences, locations, users CASCADE;
```
Then re-run the seed: `npx prisma db seed`

**Option C: Add a reset script** (optional convenience)
Create a `prisma/reset-workshop.ts` script that truncates all tables and re-seeds. Useful if you need to reset the deployed Cloud SQL database between workshop sessions without running a full migration reset:
```bash
npx ts-node prisma/reset-workshop.ts
```

**For the deployed Cloud SQL database:**
- Connect via Cloud SQL proxy or `gcloud sql connect`
- Run the TRUNCATE from Option B
- Re-run seed against the production DATABASE_URL

---

## Verification

1. Run `npx prisma migrate dev` — migration succeeds
2. Run `npx prisma db seed` — groups, users, and API keys created
3. Run `npm run test` — unit tests pass (including new `api-key.service.spec.ts`)
4. Run `npm run test:e2e` — e2e tests pass (guards are mocked, same as before)
5. Test all three userId resolution paths:
   ```bash
   # Path 1: X-User-Id header (primary)
   curl -X POST http://localhost:3000/graphql \
     -H "Authorization: Bearer <api-key>" \
     -H "X-User-Id: <userId>" \
     -H "Content-Type: application/json" \
     -d '{"query": "{ me { userId email } }"}'

   # Path 2: ?asUser= query param (MCP fallback)
   curl -X POST "http://localhost:3000/mcp?asUser=<userId>" \
     -H "Authorization: Bearer <api-key>" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

   # Path 3: Compound token (last resort)
   curl -X POST http://localhost:3000/graphql \
     -H "Authorization: Bearer <api-key>.<userId>" \
     -H "Content-Type: application/json" \
     -d '{"query": "{ me { userId email } }"}'
   ```
6. Test frontend: open the web app, paste API key, select user, verify dashboard loads

---

## Appendix: Workshop Connection Guide

Create `docs/WORKSHOP_CONNECTION_GUIDE.md` — a handout for workshop participants explaining how to connect to the system. Include:

### What you'll receive
- An **API key** (e.g., `grp-a-a1b2c3d4e5f6...`) — identifies your group
- A list of **User IDs** (UUIDs) — the users your group can act as
- The **server URL** (e.g., `https://context-router-xxx.run.app`)

### Method 1: GraphQL API (direct HTTP)
Best for: Custom applications, scripts, Postman, curl
```bash
curl -X POST https://<server>/graphql \
  -H "Authorization: Bearer <your-api-key>" \
  -H "X-User-Id: <your-user-id>" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ me { userId email firstName lastName } }"}'
```

### Method 2: MCP with custom headers
Best for: MCP clients that support custom headers
- Server URL: `https://<server>/mcp`
- Headers:
  - `Authorization: Bearer <your-api-key>`
  - `X-User-Id: <your-user-id>`

### Method 3: MCP with URL parameter
Best for: MCP clients that only let you configure a URL (e.g., Claude Desktop)
- Server URL: `https://<server>/mcp?asUser=<your-user-id>`
- Token/Bearer: `<your-api-key>`

> **Note for Claude Desktop users:** If you're putting this in `claude_desktop_config.json`, make sure to escape quotes properly in the JSON. The URL goes in a string field, so `?asUser=` doesn't need special escaping, but the surrounding JSON must be valid.

### Method 4: MCP with compound token
Best for: MCP clients where the only configurable field is "bearer token"
- Server URL: `https://<server>/mcp`
- Token/Bearer: `<your-api-key>.<your-user-id>`

### Method 5: Web Dashboard
Best for: Browsing and managing preferences visually
1. Open `https://<frontend-url>`
2. Paste your API key
3. Select your User ID
4. Browse the dashboard

### Troubleshooting
- **401 Unauthorized** — Check your API key is correct (case-sensitive, no extra spaces)
- **"User not associated with API key group"** — The user ID you're using doesn't belong to your group. Check the list of user IDs you were given.
- **"No userId resolved"** — You need to provide a user ID via one of the methods above
- **CORS errors in browser** — Make sure you're using the correct frontend URL, not calling the API directly from browser JS on a different domain

---

## Implementation Summary

All steps above have been implemented on the `gates-workshop-2026` branch. Here's what was changed:

### Backend changes

**New files:**
- `src/modules/auth/api-key.service.ts` — SHA-256 key validation, user-group membership checks, prefix-only debug logging
- `src/common/guards/api-key.guard.ts` — Single guard with three-tier userId resolution (header → query param → compound token), `@Public()` support via Reflector
- `src/modules/auth/api-key.service.spec.ts` — 8 unit tests covering all auth success/failure paths
- `prisma/migrations/workshop_api_key_auth/migration.sql` — Drops `external_identities`, creates `api_keys` and `api_key_users` tables

**Modified files:**
- `prisma/schema.prisma` — Removed `ExternalIdentity`, added `ApiKey` + `ApiKeyUser` models
- `prisma/seed.ts` — Rewritten to generate API keys for 2 groups x 3 users, prints credentials to console
- `src/modules/auth/auth.module.ts` — Now `@Global()`, provides `ApiKeyService` + `ApiKeyGuard`
- `src/main.ts` — Added `X-User-Id` to CORS `allowedHeaders`
- `src/app.module.ts` — Removed `Auth0Module` and `authConfig`
- `src/mcp/mcp.module.ts` — Removed OAuth controllers and MCP auth guard
- `src/config/mcp.config.ts` — Removed `oauth` section
- `package.json` — Added `prisma.seed` config, removed 6 Auth0/Passport dependencies
- `.env.example`, `.env.test` — Removed all Auth0 environment variables
- All resolvers and controllers — Swapped to `@UseGuards(ApiKeyGuard)`
- `test/setup/test-app.ts` — Single `ApiKeyGuard` override replaces old `GqlAuthGuard` + `JwtAuthGuard`

**Deleted files (12+):**
- `src/modules/auth/auth.service.ts`, `src/modules/auth/strategies/` (JWT strategy)
- `src/infrastructure/auth0/` (Auth0 module + service)
- `src/modules/external-identity/` (entire directory)
- `src/common/guards/gql-auth.guard.ts`, `jwt-auth.guard.ts`, `optional-gql-auth.guard.ts`
- `src/mcp/auth/` (MCP auth guard, OAuth metadata controller, DCR shim, rate limit guard)
- `src/config/auth.config.ts`

### Frontend changes

**New files:**
- `lib/workshop-auth.tsx` — `WorkshopAuthProvider` context with localStorage persistence, `useWorkshopAuth()` hook
- `lib/auth-headers.ts` — `getAuthHeaders()` helper returning `{ authorization, "x-user-id" }` from localStorage

**Modified files:**
- `app/layout.tsx` — `WorkshopAuthProvider` > `ApolloWrapper` wrapping (replaced `UserProvider` from Auth0)
- `lib/apollo-wrapper.tsx` — Plain `ApolloClient` with `setContext` link injecting auth headers from localStorage at request time
- `app/page.tsx` — Rewritten as workshop connect form (API key + userId inputs)
- `app/dashboard/page.tsx` — Client component using `useQuery` + `useWorkshopAuth()`
- `app/dashboard/profile/page.tsx` — Client component using `useQuery`
- `app/dashboard/profile/ProfileForm.tsx` — Uses Apollo `useMutation` directly (no more API route proxy)
- `app/dashboard/chat/ChatBox.tsx` — Uses Apollo `useLazyQuery` directly (no more API route proxy)
- `app/dashboard/preferences/page.tsx` — Client component with typed `useQuery`
- `app/dashboard/preferences/PreferencesClient.tsx` — Own `ApolloClient` instance with `getAuthHeaders()`
- `app/dashboard/preferences/components/*.tsx` — All 4 components updated to use `getAuthHeaders()` instead of `accessToken` prop
- `package.json` — Removed `@auth0/nextjs-auth0`, `@apollo/experimental-nextjs-app-support`, `client-only`
- `.env.example` — Removed Auth0 vars

**Deleted files:**
- `lib/auth0.ts`, `lib/apollo-client.ts` (server-side Apollo client)
- `middleware.ts` (no longer needed — auth is client-side)
- `app/api/profile/update/route.ts`, `app/api/chat/route.ts`, `app/api/debug/token/route.ts` (API routes replaced by direct Apollo hooks)

### Environment variables to update

**Backend `apps/backend/.env` — remove:**
`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_ISSUER`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_MANAGEMENT_API_AUDIENCE`, `AUTH0_SYNC_STRATEGY`, `AUTH0_MCP_PUBLIC_CLIENT_ID`, `MCP_RESOURCE`, `MCP_OAUTH_REGISTER_RATE_LIMIT`

**Backend `cloudrun.env` — same removals.** Back up first: `cp cloudrun.env cloudrun.env.production-backup`

**Frontend `apps/web/.env.local` — remove:**
`AUTH0_SECRET`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`, `APP_BASE_URL`

No new env vars needed — API keys live in the database.

**Important for deployment:** Set `GRAPHQL_DEBUG=false` in `cloudrun.env` so error stacktraces aren't exposed to workshop attendees.

---

## Local Testing

### Quick start

```bash
# Terminal 1: Start database + backend
docker compose up --build

# Terminal 2: Run migration + seed (from host, not inside container)
cd apps/backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/context_router?schema=public" \
  pnpm exec prisma migrate reset --force
# Save the printed API keys and user IDs!

# Restart app to pick up fresh DB
cd ../..
docker compose restart app

# Terminal 3: Start frontend
pnpm dev:web
```

### Test auth script

```bash
./scripts/test-auth.sh <api-key> <user-id> [base-url]
```

Tests all 3 auth paths, 2 negative cases, and health check.

### Test the web UI

1. Open http://localhost:3002
2. Paste an API key from the seed output
3. Enter a user ID from that group
4. Click Connect — dashboard should load with user data
5. Try Edit Profile, Preferences, and AI Chat pages

### Run automated tests

```bash
# Unit tests (no DB needed) — includes 8 new api-key.service tests
cd apps/backend && pnpm test:unit

# Integration + e2e (need test DB running)
pnpm test:db:up && pnpm test:db:migrate && pnpm test
```

### Notes

- Run Prisma commands from the **host machine**, not inside the Docker container. The container's production image doesn't have the Prisma CLI, and `npx` will pull Prisma 7 which has breaking changes.
- The seed script is **not idempotent** — running it twice creates duplicate API key rows. Use `prisma migrate reset --force` to start fresh.
- Apollo Client v4 exports React hooks from `@apollo/client/react`, not the main `@apollo/client` entry point.

---

## Future Improvements

- **Make seed idempotent:** Delete existing API keys by group name before creating, or upsert by group name, so `prisma db seed` can be re-run safely without a full reset.
- **Add more groups to seed:** Edit `prisma/seed.ts` to add Group C, D, etc. following the same pattern. Reset DB after.
- **Admin endpoint for key management:** A GraphQL mutation (behind an admin-only guard) to create/revoke API keys and add users to groups at runtime, avoiding seed script edits.
- **Key rotation:** Generate a new key for a group without invalidating existing user assignments — just update the `keyHash` on the existing `ApiKey` row.
- **Rate limiting per API key:** Track request counts per `keyHash` to prevent one group from overwhelming the backend during the workshop.
- **Prisma 7 upgrade:** Defer until after the workshop. Requires `prisma.config.ts`, new client constructor, and removal of `url` from schema. Do this on `main`, not the workshop branch.
