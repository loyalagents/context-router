# Context Router: User Onboarding & Frontend Integration Strategy

**Project:** Context Router API
**Current State:** NestJS GraphQL backend with Auth0 authentication (no frontend)
**Repository:** https://github.com/loyalagents/context-router
**Stack:** NestJS + GraphQL + Prisma + PostgreSQL + Auth0 + Docker

---

## 1. CURRENT PROJECT STRUCTURE

### Backend Organization (NestJS Monolith)

```
context-router/
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root module
│   ├── schema.gql                       # Auto-generated GraphQL schema
│   │
│   ├── modules/                         # Business logic modules
│   │   ├── auth/                        # Authentication module
│   │   │   ├── auth.service.ts          # User sync logic
│   │   │   ├── auth.resolver.ts         # GraphQL queries (me, etc.)
│   │   │   ├── auth.module.ts
│   │   │   └── strategies/
│   │   │       └── jwt.strategy.ts      # JWT validation with Auth0
│   │   │
│   │   ├── user/                        # User management
│   │   │   ├── user.service.ts
│   │   │   ├── user.resolver.ts         # GraphQL CRUD (users, createUser, etc.)
│   │   │   ├── user.repository.ts
│   │   │   ├── dto/                     # Input validation
│   │   │   │   ├── create-user.input.ts
│   │   │   │   └── update-user.input.ts
│   │   │   └── models/
│   │   │       └── user.model.ts        # GraphQL type definition
│   │   │
│   │   ├── preferences/                 # User preferences (locations, settings)
│   │   │   ├── preference/              # Generic key-value preferences
│   │   │   └── location/                # Location-specific preferences
│   │   │
│   │   ├── external-identity/           # Multi-provider identity linking
│   │   │   ├── external-identity.service.ts
│   │   │   └── external-identity.repository.ts
│   │   │
│   │   └── health/                      # Health check endpoint
│   │       └── health.controller.ts
│   │
│   ├── infrastructure/                  # External service integrations
│   │   ├── auth0/
│   │   │   ├── auth0.service.ts         # Auth0 Management API wrapper
│   │   │   └── auth0.module.ts
│   │   ├── prisma/
│   │   │   ├── prisma.service.ts        # Database client
│   │   │   └── prisma.module.ts
│   │   ├── cache/                       # (Placeholder for Redis/etc.)
│   │   └── http/                        # (Placeholder for HTTP clients)
│   │
│   ├── common/                          # Shared utilities
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts    # @CurrentUser() for resolvers
│   │   │   ├── roles.decorator.ts           # @Roles() (decorator only, no guard)
│   │   │   └── public.decorator.ts          # @Public() to skip auth
│   │   ├── guards/
│   │   │   ├── gql-auth.guard.ts            # GraphQL authentication guard
│   │   │   ├── jwt-auth.guard.ts            # REST authentication guard
│   │   │   └── optional-gql-auth.guard.ts   # Optional authentication
│   │   ├── filters/                         # Exception filters
│   │   ├── interceptors/                    # Response interceptors
│   │   └── pipes/                           # Validation pipes
│   │
│   ├── config/                          # Configuration modules
│   │   ├── app.config.ts                # General app config
│   │   ├── auth.config.ts               # Auth0 configuration
│   │   ├── graphql.config.ts            # GraphQL setup
│   │   └── mcp.config.ts                # MCP server config
│   │
│   ├── mcp/                             # Model Context Protocol server
│   │   ├── mcp.controller.ts            # POST /mcp endpoint
│   │   ├── mcp.service.ts               # MCP SDK integration
│   │   ├── tools/                       # MCP tool implementations
│   │   │   ├── preference-search.tool.ts
│   │   │   └── preference-mutation.tool.ts
│   │   └── resources/
│   │       └── schema.resource.ts
│   │
│   └── graphql/                         # GraphQL utilities
│       ├── loaders/                     # DataLoader for N+1 prevention
│       ├── plugins/                     # GraphQL plugins
│       └── scalars/                     # Custom scalars
│
├── prisma/
│   ├── schema.prisma                    # Database schema
│   ├── seed.ts                          # Database seeding
│   └── migrations/                      # Version-controlled migrations
│
├── test/
│   └── e2e/
│       └── mcp.e2e.spec.ts
│
├── docs/
│   ├── AUTHORIZATION_TODO.md            # Known security gaps
│   └── MCP_INTEGRATION.md               # MCP server docs
│
├── Root level files:
│   ├── AUTH0_SETUP.md                   # Auth0 configuration guide
│   ├── QUICK_START.md                   # Getting started guide
│   ├── README.md                        # Project overview
│   ├── docker-compose.yml               # PostgreSQL container
│   ├── .env.example                     # Environment variables template
│   ├── get-test-token.sh                # Get M2M token from Auth0
│   ├── test-auth.sh                     # Test authentication flow
│   └── test-graphql.sh                  # Test GraphQL queries
│
└── package.json                         # Dependencies & scripts
```

---

## 2. CURRENT AUTHENTICATION FLOW

### How It Works Today

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User obtains JWT token from Auth0                           │
│     (Currently: M2M client credentials or external login)       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Client sends request to GraphQL API                         │
│     Headers: { Authorization: "Bearer <jwt_token>" }            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. GqlAuthGuard intercepts request                             │
│     → Delegates to JwtStrategy (src/modules/auth/strategies/)   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. JwtStrategy validates token                                 │
│     • Fetches JWKS from Auth0                                   │
│     • Verifies signature, expiration, audience                  │
│     • Extracts payload: { sub, email, name, roles }             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. JwtStrategy calls AuthService.validateAndSyncUser()         │
│     (src/modules/auth/auth.service.ts)                          │
│                                                                  │
│     • Checks external_identities for provider='auth0'           │
│     • If not found, checks users table by email                 │
│     • If still not found AND AUTH0_SYNC_STRATEGY='ON_LOGIN':    │
│       ┌────────────────────────────────────────────────────┐    │
│       │  a. Fetch full profile from Auth0 Management API  │    │
│       │  b. Create new User record in PostgreSQL          │    │
│       │  c. Create ExternalIdentity linking Auth0 to user │    │
│       └────────────────────────────────────────────────────┘    │
│     • Returns User object                                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. User object attached to request context                     │
│     → Available in resolvers via @CurrentUser() decorator       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. Resolver executes with authenticated user context           │
│     Example: me query returns current user's profile            │
└─────────────────────────────────────────────────────────────────┘
```

### Database Schema for Users

```prisma
// prisma/schema.prisma

model User {
  userId             String             @id @default(uuid())
  email              String             @unique
  firstName          String
  lastName           String
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  // Relationships
  externalIdentities ExternalIdentity[]
  locations          Location[]
  preferences        Preference[]
}

model ExternalIdentity {
  id             String   @id @default(uuid())
  userId         String
  provider       String   // 'auth0', 'google', 'github', etc.
  providerUserId String   // e.g., Auth0 user ID from 'sub' claim
  metadata       Json?    // Provider-specific data
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
}
```

**Key Design Decisions:**
- No passwords stored (delegated to Auth0)
- Multi-provider support via `external_identities` table
- Email is unique across all users
- Users can link multiple OAuth providers to same account

---

## 3. WHAT'S MISSING FOR USER ONBOARDING

### Critical Gaps (Documented in `docs/AUTHORIZATION_TODO.md`)

#### ❌ No Public Signup Flow
**Current State:**
- Users must be created in Auth0 externally (manual or via Management API)
- On first API call with valid token, user auto-syncs to database
- Works for M2M clients and admin-created users
- **NOT suitable for public user registration**

**What's Needed:**
- Frontend signup interface
- Integration with Auth0 signup (Universal Login, Lock widget, or custom)
- Email verification flow
- Post-signup onboarding experience

#### ❌ No Authorization (Only Authentication)
**Current State:**
- ✅ Users must have valid JWT to access API
- ❌ ANY authenticated user can update/delete ANY other user
- ❌ No ownership checks in mutations
- ❌ Roles decorator exists but no RolesGuard implementation

**Example Vulnerability:**
```graphql
# User A (userId: "abc-123") can do this:
mutation {
  updateUser(updateUserInput: {
    userId: "xyz-789"  # User B's ID
    email: "hacked@example.com"
  }) {
    userId
    email
  }
}
# ⚠️ This SUCCEEDS - User A modified User B's account!
```

**What's Needed:**
- Resource ownership validation
- RolesGuard implementation for admin operations
- Field-level permissions
- Audit logging

#### ❌ No Email Verification Enforcement
**Current State:**
- Auth0 can send verification emails
- JWT contains `email_verified` claim
- Application doesn't check this claim
- Unverified users can access all features

**What's Needed:**
- Check `email_verified` in JwtStrategy
- Block unverified users from sensitive operations
- Resend verification email endpoint

#### ❌ No User-Facing Documentation
**Current State:**
- Excellent developer documentation (AUTH0_SETUP.md, QUICK_START.md)
- Test scripts for developers
- No guidance for end users

**What's Needed:**
- "How to sign up" guide
- "Getting started" tutorial
- Troubleshooting common errors

---

## 4. PROPOSED FRONTEND INTEGRATION APPROACHES

### Option A: Auth0 Universal Login (Recommended for MVP)

**Architecture:**
```
Frontend App (React/Next.js/etc.)
├── pages/
│   ├── index.tsx                    # Landing page with "Sign Up" button
│   ├── login.tsx                    # Redirects to Auth0 Universal Login
│   ├── callback.tsx                 # Handles Auth0 redirect
│   └── dashboard.tsx                # Protected page (requires auth)
│
├── lib/
│   ├── auth0.ts                     # Auth0 SPA SDK config
│   └── graphql-client.ts            # Apollo Client with auth headers
│
└── components/
    ├── LoginButton.tsx              # Triggers Auth0 login
    ├── LogoutButton.tsx
    └── ProtectedRoute.tsx           # Route guard component
```

**Flow:**
1. User clicks "Sign Up" → Redirect to Auth0 Universal Login
2. User creates account on Auth0's hosted page
3. Auth0 redirects back to `/callback` with authorization code
4. Frontend exchanges code for JWT token
5. Frontend stores token, makes GraphQL request
6. Backend auto-syncs user to database on first request ✅ (Already implemented!)

**Pros:**
- Zero backend code changes needed
- Email verification, password reset, MFA handled by Auth0
- Production-ready security
- Fast to implement

**Cons:**
- Users leave your site during signup
- Limited UI customization (on free tier)

---

### Option B: Embedded Auth0 Lock Widget

**Architecture:**
```
Frontend App
├── pages/
│   ├── index.tsx                    # Has embedded Lock widget
│   └── dashboard.tsx
│
├── components/
│   └── Auth0Lock.tsx                # Lock widget component
│
└── lib/
    └── graphql-client.ts
```

**Flow:**
1. User fills signup form in embedded widget (stays on your site)
2. Widget communicates with Auth0 directly
3. Returns JWT to frontend
4. Same as Option A from step 5

**Pros:**
- Users never leave your application
- Some UI customization available
- Still delegating auth complexity to Auth0

**Cons:**
- Lock widget UI can feel dated
- Less customization than fully custom form

---

### Option C: Custom Signup Form + Auth0 Management API

**Architecture:**
```
context-router/
└── src/
    └── modules/
        └── auth/
            ├── auth.controller.ts       # NEW: REST endpoints
            │   ├── POST /auth/signup
            │   ├── POST /auth/resend-verification
            │   └── POST /auth/forgot-password
            │
            ├── dto/
            │   └── signup.dto.ts        # NEW: Validation for signup
            │
            └── auth.service.ts          # ADD: createUserInAuth0() method
```

**Example Implementation:**
```typescript
// src/modules/auth/auth.controller.ts
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private auth0Service: Auth0Service,
  ) {}

  @Post('signup')
  @Public()  // No authentication required
  async signup(@Body() signupDto: SignupDto) {
    // 1. Validate input (email format, password strength, etc.)
    // 2. Check if user already exists in your DB
    // 3. Create user in Auth0
    const auth0User = await this.auth0Service
      .getManagementClient()
      .users.create({
        email: signupDto.email,
        password: signupDto.password,
        connection: 'Username-Password-Authentication',
        user_metadata: {
          firstName: signupDto.firstName,
          lastName: signupDto.lastName,
        },
        email_verified: false,
      });

    // 4. Auth0 sends verification email automatically
    // 5. User will auto-sync to DB on first login (existing logic)

    return {
      message: 'Signup successful. Please check your email to verify your account.',
      userId: auth0User.user_id,
    };
  }
}
```

**Pros:**
- Complete control over signup UX
- Can add custom business logic (referral codes, beta access, etc.)
- Multi-step onboarding flows
- Collect additional data during signup

**Cons:**
- More code to write and maintain
- Must handle security carefully
- Need to build email verification UI
- Need to build password reset UI

---

## 5. WHERE WOULD FRONTEND CODE LIVE?

### Recommended Project Structure (Monorepo)

**Option 1: Separate Repository**
```
/Users/lucasnovak/loyal-agents/
├── context-router/              # Backend (existing)
│   └── src/
│       └── modules/
│           └── auth/
│
└── context-router-web/          # Frontend (new)
    ├── package.json
    ├── next.config.js           # (if using Next.js)
    ├── src/
    │   ├── app/                 # Next.js app directory
    │   │   ├── page.tsx         # Landing page
    │   │   ├── login/
    │   │   ├── dashboard/
    │   │   └── callback/
    │   │
    │   ├── components/
    │   │   ├── auth/
    │   │   │   ├── LoginButton.tsx
    │   │   │   ├── LogoutButton.tsx
    │   │   │   └── ProtectedRoute.tsx
    │   │   │
    │   │   └── layout/
    │   │       ├── Header.tsx
    │   │       └── Sidebar.tsx
    │   │
    │   ├── lib/
    │   │   ├── auth0.ts         # Auth0 config
    │   │   ├── apollo-client.ts # GraphQL client
    │   │   └── hooks/
    │   │       ├── useAuth.ts
    │   │       └── useUser.ts
    │   │
    │   └── graphql/
    │       ├── queries/
    │       │   ├── me.graphql
    │       │   └── users.graphql
    │       └── mutations/
    │           └── updateUser.graphql
    │
    └── public/
        └── logo.svg
```

**Option 2: Monorepo (NX, Turborepo, or pnpm workspaces)**
```
/Users/lucasnovak/loyal-agents/context-router/
├── package.json                 # Root workspace config
├── pnpm-workspace.yaml
│
├── apps/
│   ├── api/                     # Backend (move existing src/ here)
│   │   ├── src/
│   │   ├── prisma/
│   │   └── package.json
│   │
│   └── web/                     # Frontend (new)
│       ├── src/
│       └── package.json
│
├── packages/                    # Shared code
│   ├── types/                   # Shared TypeScript types
│   │   └── user.types.ts
│   │
│   └── graphql-schema/          # Shared GraphQL schema
│       └── schema.gql
│
└── docs/
    ├── API.md
    └── FRONTEND_SETUP.md
```

**Option 3: Co-located (Simple, Good for Small Teams)**
```
/Users/lucasnovak/loyal-agents/context-router/
├── backend/                     # Rename src/ to backend/
│   ├── src/
│   ├── prisma/
│   └── package.json
│
├── frontend/                    # New Next.js app
│   ├── src/
│   └── package.json
│
├── docker-compose.yml           # Add frontend service
└── package.json                 # Workspace scripts
```

---

## 6. INTEGRATION POINTS BETWEEN FRONTEND & BACKEND

### What Frontend Needs from Backend

**1. GraphQL Endpoint**
- ✅ Already exists: `http://localhost:3000/graphql`
- ✅ CORS configured (check `CORS_ORIGIN` in .env)

**2. Available GraphQL Operations**
```graphql
# Queries (all require authentication)
query Me {
  me {
    userId
    email
    firstName
    lastName
    preferences {
      preferenceId
      key
      value
    }
  }
}

query Users {
  users {
    userId
    email
    firstName
    lastName
  }
}

# Mutations (require authentication, NO ownership checks yet!)
mutation CreateUser($input: CreateUserInput!) {
  createUser(createUserInput: $input) {
    userId
    email
  }
}

mutation UpdateUser($input: UpdateUserInput!) {
  updateUser(updateUserInput: $input) {
    userId
    email
    firstName
    lastName
  }
}
```

**3. Authentication Headers**
```typescript
// Apollo Client config example
const client = new ApolloClient({
  uri: process.env.NEXT_PUBLIC_GRAPHQL_URL,
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
```

**4. Environment Variables Frontend Needs**
```env
# Frontend .env.local
NEXT_PUBLIC_AUTH0_DOMAIN=your-tenant.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-frontend-client-id
NEXT_PUBLIC_AUTH0_REDIRECT_URI=http://localhost:3000/callback
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:3000/graphql
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### What Backend Needs to Support Frontend

**1. CORS Configuration** ✅ (Already configured)
- Update `CORS_ORIGIN` in .env to include frontend URL
- Currently: `CORS_ORIGIN=http://localhost:3000,http://localhost:3001`

**2. Auth0 Application Configuration**
- Create new Auth0 Application (type: Single Page Application)
- Configure Allowed Callback URLs
- Configure Allowed Logout URLs
- Configure Allowed Web Origins

**3. Security Hardening** ❌ (Not yet implemented)
- Add resource ownership checks
- Implement RolesGuard
- Add email verification enforcement

**4. New Endpoints (if using Option C - Custom Signup)**
- `POST /auth/signup` - Create user in Auth0
- `POST /auth/verify-email` - Trigger verification email
- `POST /auth/forgot-password` - Initiate password reset

---

## 7. QUESTIONS FOR CONSIDERATION

### Technical Decisions

1. **Frontend Framework**
   - Next.js (recommended for SEO, SSR)
   - React SPA (Vite)
   - Other (Vue, Svelte, etc.)?

2. **Authentication Approach**
   - Option A: Auth0 Universal Login (fastest)
   - Option B: Embedded Lock widget
   - Option C: Custom signup form?

3. **Project Structure**
   - Separate repos?
   - Monorepo (NX, Turborepo)?
   - Co-located?

4. **GraphQL Client**
   - Apollo Client (most popular)
   - urql (lightweight)
   - graphql-request (minimal)?

5. **Deployment Strategy**
   - Frontend: Vercel, Netlify, Cloudflare Pages?
   - Backend: Already using Docker, deploy where?
   - Separate domains or unified?

### Product & UX Decisions

6. **User Onboarding Flow**
   - Just signup → done?
   - Multi-step onboarding (profile, preferences, tutorial)?
   - Require email verification before first login?

7. **User Roles**
   - Just "user" for now?
   - Need admin role immediately?
   - Other roles (organization owner, member, etc.)?

8. **Data Users Can Self-Manage**
   - Profile (name, email)?
   - Preferences (already have DB schema)?
   - Locations (already have DB schema)?
   - Account deletion?

9. **Social Login**
   - Just email/password?
   - Add Google, GitHub, etc.?
   - Auth0 makes this trivial to add

10. **Post-MVP Features**
    - User profile photos?
    - Organization/team management?
    - API keys for programmatic access?
    - Usage billing/metering?

---

## 8. IMMEDIATE NEXT STEPS (Prioritized)

### Phase 1: Security (CRITICAL - Before Any Frontend)

**Estimated Time: 2-3 days**

1. **Add Resource Ownership Checks**
   - File: `src/modules/user/user.resolver.ts`
   - Prevent users from modifying other users' data
   - Example: Only allow `updateUser` if `currentUser.userId === input.userId`

2. **Implement Email Verification Check**
   - File: `src/modules/auth/strategies/jwt.strategy.ts`
   - Check `payload.email_verified === true`
   - Return 403 if not verified

3. **Add RolesGuard**
   - File: `src/common/guards/roles.guard.ts` (create)
   - Use existing `@Roles()` decorator
   - Protect admin-only operations (delete any user, etc.)

4. **Configure Auth0 Roles**
   - Create Auth0 Action to include roles in JWT
   - Add `roles` claim to token
   - Document in AUTH0_SETUP.md

### Phase 2: Choose & Implement Signup Approach

**Option A: Auth0 Universal Login (Fastest - 1 day)**
- Create Auth0 SPA application
- Add frontend with Auth0 SDK
- Test signup flow
- Deploy

**Option B: Embedded Lock (2 days)**
- Same as Option A
- Integrate Lock widget
- Customize appearance

**Option C: Custom Signup (1 week)**
- Create signup endpoint in backend
- Build custom signup UI
- Implement email verification flow
- Build password reset flow
- Add comprehensive testing

### Phase 3: Frontend MVP

**Estimated Time: 1-2 weeks (depending on scope)**

1. **Project Setup**
   - Choose project structure
   - Initialize Next.js/React app
   - Configure TypeScript, ESLint, etc.

2. **Authentication Pages**
   - Landing page
   - Login/Signup
   - Callback handler
   - Logout

3. **Protected Dashboard**
   - User profile view
   - Edit profile form
   - Preferences management

4. **GraphQL Integration**
   - Apollo Client setup
   - Code generation from schema (optional but recommended)
   - Error handling
   - Loading states

5. **Testing & Deployment**
   - E2E tests (Playwright, Cypress)
   - Deploy frontend
   - Update CORS settings
   - Update Auth0 callback URLs

---

## 9. RECOMMENDED TECH STACK FOR FRONTEND

Based on your backend stack and modern best practices:

```
Frontend Technology Recommendations:

Framework:         Next.js 14+ (App Router)
Language:          TypeScript
GraphQL Client:    Apollo Client 3
Auth SDK:          @auth0/nextjs-auth0 (for Next.js)
                   OR @auth0/auth0-react (for pure React)
State Management:  Apollo Client cache + React Context
                   (Zustand or Jotai if need more)
UI Components:     shadcn/ui (highly recommended)
                   OR Material-UI (MUI)
Styling:           Tailwind CSS
Forms:             React Hook Form + Zod validation
Testing:           Vitest + Testing Library + Playwright
Code Gen:          GraphQL Code Generator (auto-generate types)
Deployment:        Vercel (easiest for Next.js)
```

**Why This Stack:**
- Next.js: SEO, SSR, great DX, easy deployment
- TypeScript: Type safety across frontend + backend
- Apollo Client: Best GraphQL client, handles caching well
- Auth0 SDK: Official, maintained, handles all edge cases
- shadcn/ui: Beautiful components, full ownership, Tailwind-based
- Tailwind: Fast styling, great for prototyping
- Vercel: Zero-config Next.js deployment

---

## 10. EXAMPLE: AUTH0 UNIVERSAL LOGIN IMPLEMENTATION

### Backend Changes (Minimal)

**1. Update CORS** (`.env`)
```env
CORS_ORIGIN=http://localhost:3001,https://your-frontend.vercel.app
```

**2. Enforce Email Verification** (`src/modules/auth/strategies/jwt.strategy.ts`)
```typescript
async validate(payload: any) {
  // Add this check:
  if (!payload.email_verified) {
    throw new UnauthorizedException('Please verify your email address');
  }

  // Existing code...
  return this.authService.validateAndSyncUser(payload);
}
```

### Frontend Implementation (Next.js)

**1. Install Dependencies**
```bash
npm install @auth0/nextjs-auth0 @apollo/client graphql
```

**2. Configure Auth0** (`app/api/auth/[auth0]/route.ts`)
```typescript
import { handleAuth } from '@auth0/nextjs-auth0';
export const GET = handleAuth();
```

**3. Environment Variables** (`.env.local`)
```env
AUTH0_SECRET='your-secret'
AUTH0_BASE_URL='http://localhost:3001'
AUTH0_ISSUER_BASE_URL='https://your-tenant.auth0.com'
AUTH0_CLIENT_ID='your-client-id'
AUTH0_CLIENT_SECRET='your-client-secret'
NEXT_PUBLIC_GRAPHQL_URL='http://localhost:3000/graphql'
```

**4. Login Button** (`components/LoginButton.tsx`)
```typescript
export function LoginButton() {
  return <a href="/api/auth/login">Sign Up / Login</a>;
}
```

**5. Protected Dashboard** (`app/dashboard/page.tsx`)
```typescript
import { getSession } from '@auth0/nextjs-auth0';
import { redirect } from 'next/navigation';

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect('/api/auth/login');

  return <div>Welcome, {session.user.email}!</div>;
}
```

**6. Apollo Client with Auth** (`lib/apollo-client.ts`)
```typescript
import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { getAccessToken } from '@auth0/nextjs-auth0';

const httpLink = createHttpLink({
  uri: process.env.NEXT_PUBLIC_GRAPHQL_URL,
});

const authLink = setContext(async (_, { headers }) => {
  const { accessToken } = await getAccessToken();
  return {
    headers: {
      ...headers,
      authorization: accessToken ? `Bearer ${accessToken}` : '',
    }
  };
});

export const client = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
});
```

**7. GraphQL Query** (`app/dashboard/page.tsx`)
```typescript
import { client } from '@/lib/apollo-client';
import { gql } from '@apollo/client';

const ME_QUERY = gql`
  query Me {
    me {
      userId
      email
      firstName
      lastName
    }
  }
`;

export default async function Dashboard() {
  const { data } = await client.query({ query: ME_QUERY });

  return (
    <div>
      <h1>Welcome, {data.me.firstName}!</h1>
      <p>Email: {data.me.email}</p>
    </div>
  );
}
```

---

## SUMMARY

**Current State:**
- ✅ Production-ready NestJS backend with Auth0 JWT authentication
- ✅ Auto-sync users from Auth0 to PostgreSQL on first login
- ✅ GraphQL API with authentication guards
- ✅ Clean architecture ready for frontend integration

**Missing:**
- ❌ Frontend application
- ❌ Public user signup flow
- ❌ Authorization (resource ownership, RBAC)
- ❌ Email verification enforcement

**Recommended Path:**
1. **Harden backend security** (ownership checks, email verification)
2. **Implement Auth0 Universal Login** (fastest to market)
3. **Build Next.js frontend** with Apollo Client
4. **Iterate on UX** (onboarding, preferences, etc.)

**Key Decision Points:**
- Frontend framework choice (Next.js recommended)
- Project structure (monorepo vs separate repos)
- Authentication approach (Universal Login vs custom)
- Deployment strategy (Vercel + existing backend host)

---

**Questions or need clarification on any section?**
