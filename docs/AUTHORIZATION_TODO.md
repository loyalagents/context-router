# Authorization Status

**Last Updated:** 2025-12-02

## ✅ What's Implemented

### Authentication & Resource Ownership
- **Auth0 JWT validation** via JWKS
- **User auto-sync** from Auth0 on first login
- **Resource ownership enforcement** - users can only access their own data:
  - ✅ User module: `findOne()`, `updateUser()` - self-only
  - ✅ Preferences module - scoped to authenticated user
  - ✅ Locations module - scoped to authenticated user
  - ✅ MCP tools - userId extracted from JWT context, not params

### Current User Endpoints
- `me` query - returns current authenticated user
- `user(id)` query - self-only
- `updateUser(updateUserInput)` mutation - self-only

## 🚧 TODO: Admin Role Support

### Goal
Enable admin users to manage the system (list users, delete users, etc.)

### Requirements
1. **Create guards and decorators:**
   - `src/common/guards/roles.guard.ts` - Check user roles
   - `src/common/decorators/roles.decorator.ts` - `@Roles('admin')` decorator

2. **Extract roles from JWT:**
   - Modify `src/modules/auth/strategies/jwt.strategy.ts`
   - Extract roles from Auth0 custom claim (e.g., `payload['https://context-router-api/roles']`)
   - Add `roles: string[]` to user object

3. **Add admin-only operations:**
   - `findAll()` query - `@Roles('admin')` - list all users
   - `createUser()` mutation - `@Roles('admin')` - manual user creation
   - `removeUser(id)` mutation - `@Roles('admin')` - delete any user

4. **Auth0 configuration:**
   - Roles should already be configured in Auth0
   - Need to add Auth0 Action to include roles in JWT custom claims

### References
- [NestJS Guards](https://docs.nestjs.com/guards)
- [Auth0 Custom Claims](https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims)

## 🚧 TODO: User Deletion

### Goal
Allow users to delete their own accounts (self-service) and admins to delete any user

### Requirements
1. **Self-service deletion:**
   - Add `deleteMyAccount()` mutation
   - Verifies `currentUser.userId` matches the account being deleted
   - Cascades to related data (preferences, locations) via Prisma schema

2. **Admin deletion:**
   - Restore `removeUser(id)` mutation with `@Roles('admin')`
   - Requires admin role support (see above)

### Questions to Resolve
- Should deletion be soft (mark as deleted) or hard (actually remove)?
- What happens to related data (preferences, locations)? Currently set to CASCADE in schema
- Should there be a confirmation/grace period?

## 🟢 MCP Authorization (Already Secure)

MCP tools are properly implemented with user-scoped data access:
- ✅ User context extracted from JWT at controller level
- ✅ All tool handlers receive authenticated user context
- ✅ Tools use `context.user.userId`, NOT params
- ✅ AI cannot request other users' data

See implementation:
- [mcp.controller.ts](../apps/backend/src/mcp/mcp.controller.ts) - JWT validation & context creation
- [preference-search.tool.ts](../apps/backend/src/mcp/tools/preference-search.tool.ts) - Uses context.user.userId
- [preference-mutation.tool.ts](../apps/backend/src/mcp/tools/preference-mutation.tool.ts) - Uses context.user.userId

## 🔍 M2M Token Workaround (Temporary)

**Location:** [auth.service.ts:117-137](../apps/backend/src/modules/auth/auth.service.ts#L117-L137)

### What It Does
M2M tokens (client credentials flow) have `sub` like `EAf4MNS7Rw2HV45g7ALsKlTbFm6WqDy9@clients` which don't represent real users.

The `findOrCreateM2MUser()` method creates mock user objects for M2M tokens:
- Checks if a user exists with email `{clientId}@m2m.local`
- If not, creates a new user with:
  - Email: `{clientId}@m2m.local`
  - First name: `M2M`
  - Last name: `Client`
- Each M2M client gets its own isolated user in the database

### Why It's OK for Now
- ✅ Allows testing the API without real user login
- ✅ Each M2M client gets isolated data (proper authorization still enforced)
- ✅ M2M tokens still require valid Auth0 authentication
- ✅ Won't interfere with real users (different email domain)

### Why It Should Be Removed
- ❌ M2M tokens are for machine-to-machine auth, not user impersonation
- ❌ Production should only have real users via web login
- ❌ Creates clutter in the user table

### Remove When
- ✅ Frontend login is working (already implemented at `apps/web/`)
- Moving to production
- No longer need M2M tokens for testing

**Search for:** `TODO: TEMPORARY` in codebase

## Testing Strategy

### Manual Testing
```bash
# Get tokens for two users (Alice & Bob)
ALICE_TOKEN="eyJ..."
BOB_TOKEN="eyJ..."

# Alice tries to view Bob's profile (should fail with 403)
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"query": "query { user(id: \"bob-id\") { userId email } }"}'

# Alice tries to update Bob's profile (should fail with 403)
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"query": "mutation { updateUser(updateUserInput: { userId: \"bob-id\", firstName: \"Hacked\" }) { userId } }"}'
```

## Quick Reference

### Key Files
- **User resolver:** [user.resolver.ts](../apps/backend/src/modules/user/user.resolver.ts)
- **Auth strategy:** [jwt.strategy.ts](../apps/backend/src/modules/auth/strategies/jwt.strategy.ts)
- **Current user decorator:** [current-user.decorator.ts](../apps/backend/src/common/decorators/current-user.decorator.ts)
- **Auth guard:** [gql-auth.guard.ts](../apps/backend/src/common/guards/gql-auth.guard.ts)

### Authorization Pattern
```typescript
@Mutation(() => User)
@UseGuards(GqlAuthGuard)
async updateUser(
  @Args('updateUserInput') updateUserInput: UpdateUserInput,
  @CurrentUser() currentUser: User,
): Promise<User> {
  // Verify ownership
  if (currentUser.userId !== updateUserInput.userId) {
    throw new ForbiddenException('You can only update your own profile');
  }
  return this.userService.update(updateUserInput);
}
```

## MCP OAuth Authentication (Claude Desktop / ChatGPT)

**Implemented:** 2025-12-24

### Overview

MCP clients (Claude Desktop, ChatGPT) can authenticate via OAuth without manually pasting tokens. We use a "DCR Shim" pattern (Path A2) that combines:
- Our OAuth metadata endpoints for discovery
- Auth0 for actual authentication
- A pre-registered public client for all MCP connectors

### Architecture

```
Claude Desktop                    Our Server                         Auth0
      |                               |                                |
      |---> GET /.well-known/oauth-protected-resource                  |
      |<--- { resource, authorization_servers }                        |
      |                               |                                |
      |---> GET /.well-known/oauth-authorization-server                |
      |<--- { authorization_endpoint, token_endpoint, registration_endpoint }
      |                               |                                |
      |---> POST /oauth/register (DCR shim)                            |
      |<--- { client_id: "pre-registered-id" }                         |
      |                               |                                |
      |-------------------------------------------------> GET /authorize
      |                               |                   (user logs in)
      |<------------------------------------------------- redirect with code
      |                               |                                |
      |-------------------------------------------------> POST /oauth/token
      |<------------------------------------------------- { access_token (JWT) }
      |                               |                                |
      |---> POST /mcp (with Bearer token)                              |
      |<--- MCP response                                               |
```

### Key Files

- **OAuth Metadata:** [oauth-metadata.controller.ts](../apps/backend/src/mcp/auth/oauth-metadata.controller.ts)
- **DCR Shim:** [dcr-shim.controller.ts](../apps/backend/src/mcp/auth/dcr-shim.controller.ts)
- **MCP Auth Guard:** [mcp-auth.guard.ts](../apps/backend/src/mcp/auth/mcp-auth.guard.ts)
- **MCP Config:** [mcp.config.ts](../apps/backend/src/config/mcp.config.ts)

### Key Decisions

#### 1. DCR Shim Instead of Full DCR
**Decision:** Return a pre-registered Auth0 client_id instead of actually creating clients dynamically.

**Why:**
- Auth0 doesn't support public DCR without management API
- Simpler security model - one auditable client in Auth0
- Avoids client proliferation

**Trade-off:** All MCP connectors share one client_id, which is fine for our use case.

#### 2. Native App Type in Auth0
**Decision:** Use "Native" application type for the MCP client.

**Why:**
- Claude Desktop is a desktop app using PKCE
- Native apps support public clients (no client secret)
- Follows OAuth best practices for native apps

**Limitation:** Native apps can't be added to API's M2M authorization list, so we can't set a per-app default audience.

#### 3. Tenant Default Audience
**Decision:** Set `https://context-router-api` as the tenant's default audience.

**Why:**
- Claude's OAuth client doesn't send the `audience` parameter (Auth0-specific)
- Without audience, Auth0 returns opaque tokens (JWE) instead of JWTs
- Our auth guard needs JWTs to verify signatures via JWKS
- Existing apps already specify audience explicitly, so they're unaffected

**Trade-off:** Any app that doesn't specify audience will get tokens for our API. This is acceptable because:
- Our web/M2M apps already specify audience
- Only "dumb" OAuth clients (like Claude) are affected
- We can add an Auth0 Action later if we need finer control

#### 4. Separate MCP_SERVER_URL from AUTH0_AUDIENCE
**Decision:** Use two separate config values:
- `AUTH0_AUDIENCE` = `https://context-router-api` (token audience, API identifier)
- `MCP_SERVER_URL` = `https://context-router-xyz.a.run.app` (actual server URL)

**Why:**
- `registration_endpoint` in OAuth metadata must be a reachable URL
- Auth0 audience is an identifier, not necessarily a real URL
- Separation allows flexibility if we add a custom domain later

### Environment Variables

```bash
# Auth0 Configuration
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://context-router-api

# MCP OAuth Configuration
MCP_SERVER_URL=https://your-cloud-run-url.a.run.app
AUTH0_MCP_PUBLIC_CLIENT_ID=your-mcp-public-client-id
```

### Auth0 Configuration Checklist

1. **Create Native Application** for MCP connectors
   - Application Type: Native
   - Token Endpoint Auth Method: None
   - Allowed Callback URLs: `https://claude.ai/api/mcp/auth_callback`, etc.

2. **Set Default Audience** (Settings → General → API Authorization Settings)
   - Default Audience: `https://context-router-api`

3. **API Settings** (Applications → APIs → Context Router API)
   - Signing Algorithm: RS256
   - JWE Encryption: Off

### Debugging

Check token format in Cloud Run logs:
```bash
gcloud logging read "resource.type=cloud_run_revision AND textPayload:\"Token parts\"" --limit=5
```

- **3 parts** = JWT (correct)
- **5 parts** = JWE/opaque token (wrong - check audience config)

### Future: MCP Scope-Based Access Control

Not implemented yet. When needed, add scope checking in the MCP controller using `request.tokenScopes` (already extracted by `McpAuthGuard`). Map tool names to required scopes (e.g., `create_preference` → `preferences:write`).
