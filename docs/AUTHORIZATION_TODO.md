# Authorization Implementation Plan

## Current State

### What We Have ✅
- **Authentication**: Users must provide valid Auth0 JWT tokens to access the API
- **Token Validation**: JWKS validation ensures tokens are legitimately signed by Auth0
- **User Sync**: Users are automatically created/synced from Auth0 on first login
- **External Identity Linking**: Auth0 identities are linked to local users via `external_identities` table

### What We DON'T Have ❌
- **Authorization**: No checks for what authenticated users can do
- **Resource Ownership**: Users can modify any other user's data
- **Role-Based Access Control (RBAC)**: No admin/user role distinction
- **Field-Level Security**: No restrictions on sensitive fields
- **Real User Login Flow**: Currently using M2M tokens for testing

## TEMPORARY: M2M Token Workaround

**Location**: [src/modules/auth/strategies/jwt.strategy.ts](../src/modules/auth/strategies/jwt.strategy.ts:39-53)

**Issue**: M2M tokens (client credentials) have `sub` like `EAf4MNS7Rw2HV45g7ALsKlTbFm6WqDy9@clients` which don't represent real users. These tokens lack email addresses needed for user creation.

**Temporary Fix**: JWT strategy detects M2M tokens (`sub.endsWith('@clients')`) and returns a mock user object:
```typescript
{
  userId: payload.sub,
  email: 'm2m@client.local',
  firstName: 'M2M',
  lastName: 'Client',
  // ...
}
```

**Why This is OK for Now**:
- Allows testing the API without creating real users
- M2M tokens still require valid Auth0 authentication
- Will be removed when implementing proper user login flow

**MUST BE REMOVED WHEN**:
1. Implementing frontend login (user authentication flow)
2. Adding real user registration/signup
3. Moving to production

**Search for**: `TODO: TEMPORARY` in codebase to find all related code

## Current Security Gap

**ANY authenticated user can perform ANY operation on ANY other user.**

Example vulnerability:
```typescript
// User A (userId: "abc-123") can update User B (userId: "xyz-789")
mutation {
  updateUser(
    userId: "xyz-789"  # Not User A's ID!
    data: {
      email: "malicious@example.com"
      firstName: "Hacked"
    }
  ) {
    userId
    email
  }
}
```

This will succeed as long as User A has a valid Auth0 token.

## Authorization Features to Implement

### 1. Resource Ownership Validation (HIGH PRIORITY)

**Goal**: Users can only access/modify their own resources

**Implementation**:
- Extract userId from JWT payload (stored in request.user by JwtStrategy)
- Compare with userId in mutation/query arguments
- Throw ForbiddenException if mismatch

**Code Example**:
```typescript
// src/modules/user/user.resolver.ts
@Mutation(() => User)
@UseGuards(JwtAuthGuard)
async updateUser(
  @Args('userId') userId: string,
  @Args('data') updateUserInput: UpdateUserInput,
  @CurrentUser() currentUser: User, // From JWT
) {
  // Authorization check
  if (currentUser.userId !== userId) {
    throw new ForbiddenException('You can only update your own profile');
  }

  return this.userService.update(userId, updateUserInput);
}
```

**Files to Modify**:
- `src/modules/user/user.resolver.ts` - Add ownership checks to mutations
- Create `src/common/decorators/current-user.decorator.ts` - Extract user from request
- Update all resolvers with user-specific resources

### 2. Admin Role Support (MEDIUM PRIORITY)

**Goal**: Distinguish between regular users and administrators

**Auth0 Configuration**:
- Add roles to Auth0 (User Management → Roles)
- Create "admin" and "user" roles
- Assign roles to users
- Add roles to JWT via Auth0 Action:
  ```javascript
  exports.onExecutePostLogin = async (event, api) => {
    const namespace = 'https://your-api.com';
    if (event.authorization) {
      api.idToken.setCustomClaim(`${namespace}/roles`, event.authorization.roles);
      api.accessToken.setCustomClaim(`${namespace}/roles`, event.authorization.roles);
    }
  };
  ```

**Implementation**:
- Extract roles from JWT payload in JwtStrategy
- Add roles to User object returned by validate()
- Create RolesGuard to check required roles

**Code Example**:
```typescript
// src/modules/auth/strategies/jwt.strategy.ts
async validate(payload: any) {
  const user = await this.authService.validateAndSyncUser(payload);

  // Extract roles from custom claim
  const roles = payload['https://your-api.com/roles'] || ['user'];

  return {
    ...user,
    roles, // Add roles to user object
  };
}

// src/common/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = GqlExecutionContext.create(context).getContext().req;
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}

// src/common/decorators/roles.decorator.ts
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

// Usage in resolver
@Mutation(() => User)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
async deleteUser(@Args('userId') userId: string) {
  return this.userService.delete(userId);
}
```

**Files to Create**:
- `src/common/guards/roles.guard.ts`
- `src/common/decorators/roles.decorator.ts`

**Files to Modify**:
- `src/modules/auth/strategies/jwt.strategy.ts` - Extract roles from JWT
- `src/modules/user/models/user.model.ts` - Add roles field (optional, for GraphQL schema)
- All resolvers with admin-only operations

### 3. Field-Level Security (LOW PRIORITY)

**Goal**: Hide sensitive fields from unauthorized users

**Implementation**:
- Use GraphQL field resolvers with guards
- Create custom decorators for field-level authorization

**Code Example**:
```typescript
// src/modules/user/models/user.model.ts
@ObjectType()
export class User {
  @Field(() => ID)
  userId: string;

  @Field()
  email: string; // Only visible to self or admin

  @Field()
  firstName: string;

  @Field()
  lastName: string;
}

// src/modules/user/user.resolver.ts
@ResolveField(() => String)
async email(@Parent() user: User, @CurrentUser() currentUser: User) {
  // Only show email to the user themselves or admins
  if (currentUser.userId === user.userId || currentUser.roles?.includes('admin')) {
    return user.email;
  }
  throw new ForbiddenException('You cannot view this user\'s email');
}
```

### 4. Context-Based Authorization (FUTURE)

**Goal**: More complex authorization rules based on context

**Examples**:
- Organization membership (user can only access resources in their org)
- Team membership (user can access team resources)
- Resource-specific permissions (user has "edit" permission on specific project)

**Implementation**:
- Add organization/team models to schema
- Create context-aware guards
- Implement permission system (CASL, Casbin, or custom)

## Implementation Priority

1. **Immediate** (before production):
   - Resource ownership validation for all user-specific mutations
   - CurrentUser decorator

2. **Short-term** (before multi-user production):
   - Admin role support
   - RolesGuard implementation
   - Auth0 role configuration

3. **Medium-term** (as features grow):
   - Field-level security for sensitive data
   - Organization/team-based authorization

4. **Long-term** (as system matures):
   - Full CASL/permission system
   - Audit logging for authorization failures

## Testing Authorization

### Manual Testing
```bash
# Get tokens for two different users
USER_A_TOKEN="eyJ..."
USER_B_TOKEN="eyJ..."

# Try to update User B's profile with User A's token (should fail)
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -d '{
    "query": "mutation { updateUser(userId: \"user-b-id\", data: { firstName: \"Hacked\" }) { userId } }"
  }'
# Expected: ForbiddenException
```

### Unit Testing
```typescript
// src/modules/user/user.resolver.spec.ts
it('should prevent user from updating another user', async () => {
  const currentUser = { userId: 'user-a', email: 'a@example.com' };
  const targetUserId = 'user-b';

  await expect(
    resolver.updateUser(targetUserId, { firstName: 'Hacked' }, currentUser)
  ).rejects.toThrow(ForbiddenException);
});

it('should allow admin to update any user', async () => {
  const admin = { userId: 'admin-1', email: 'admin@example.com', roles: ['admin'] };
  const targetUserId = 'user-b';

  await expect(
    resolver.updateUser(targetUserId, { firstName: 'Updated' }, admin)
  ).resolves.toBeDefined();
});
```

## Related Files

- [src/modules/auth/strategies/jwt.strategy.ts](../src/modules/auth/strategies/jwt.strategy.ts) - Currently validates token, needs role extraction
- [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) - Syncs users from Auth0
- [src/modules/user/user.resolver.ts](../src/modules/user/user.resolver.ts) - Needs ownership checks
- [src/modules/user/user.service.ts](../src/modules/user/user.service.ts) - Business logic layer

## Environment Variables Needed

When implementing RBAC:
```env
# .env
AUTH0_CUSTOM_CLAIMS_NAMESPACE=https://context-router-api  # For roles in JWT
```

## Auth0 Dashboard Configuration Needed

1. **Create Roles**:
   - Go to User Management → Roles
   - Create "admin" role
   - Create "user" role (or set as default)

2. **Add Action to Include Roles in JWT**:
   - Go to Actions → Flows → Login
   - Create custom action with code above
   - Add to login flow

3. **Assign Roles to Users**:
   - Go to User Management → Users
   - Select user → Roles tab
   - Assign appropriate role

## MCP-Specific Authorization Concerns

### TODO: MCP User Context Isolation

**Location**: To be implemented in `src/mcp/` module

**Issue**: MCP tools will expose preference operations to AI assistants. We need to ensure:
1. Each MCP request extracts userId from JWT token
2. All tool calls are scoped to that user's data only
3. AI cannot access or modify other users' preferences

**Current Gap**:
- No user-scoped filtering in MCP tool layer
- Risk: AI could potentially request data for any userId if we pass userId as a tool parameter

**Required Implementation**:
```typescript
// src/mcp/tools/preference.tools.ts
class PreferenceTools {
  async searchPreferences(params: SearchParams, context: McpContext) {
    // Extract userId from JWT in context, NOT from params
    const userId = context.user.userId;

    // Use extracted userId (safe) instead of params.userId (unsafe)
    return this.preferenceService.findByCategory(userId, params.category);
  }
}
```

**Dependencies**:
- Must implement resource ownership validation (Priority #1 above) BEFORE exposing MCP tools
- MCP authentication middleware must validate JWT and attach user to context
- All MCP tools must receive authenticated user context

**Priority**: HIGH - Must be implemented during MCP development, not after

**Search for**: `TODO: MCP_USER_CONTEXT` in codebase when implementing

### TODO: MCP Search Authorization

**Location**: To be implemented in `src/mcp/tools/search.tools.ts`

**Issue**: MCP search tool will initially expose all GraphQL query capabilities. We need to restrict search to only return results the authenticated user can access.

**Current Plan**:
- Start with basic GraphQL filtering (search across all preferences)
- Future: Add user-scoped filtering automatically

**Security Concern**:
- If search doesn't filter by userId, AI could discover other users' data
- Even read-only access is a privacy violation

**Required Implementation**:
```typescript
// Phase 1 (MVP): Explicitly filter by userId from JWT
async searchPreferences(params: SearchParams, context: McpContext) {
  const userId = context.user.userId;

  // ALWAYS include userId filter
  return this.preferenceService.findByCategory(userId, params.category);
}

// Phase 2 (Future): Auto-inject userId filter into all GraphQL queries
// - Add middleware that rewrites queries to include userId filter
// - Prevent AI from specifying userId in search parameters
```

**Priority**: HIGH - Phase 1 must be part of MVP

**Timeline**:
- Phase 1: Implement with MCP MVP (explicit userId filtering)
- Phase 2: After basic RBAC is in place (automatic query rewriting)

**Search for**: `TODO: MCP_SEARCH_AUTH` in codebase when implementing

## References

- [NestJS Guards Documentation](https://docs.nestjs.com/guards)
- [NestJS GraphQL Authorization](https://docs.nestjs.com/graphql/other-features#execute-enhancers-at-the-field-resolver-level)
- [Auth0 Roles Documentation](https://auth0.com/docs/manage-users/access-control/rbac)
- [Auth0 Custom Claims](https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims)
- [Model Context Protocol Spec](https://spec.modelcontextprotocol.io/)
