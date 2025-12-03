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
