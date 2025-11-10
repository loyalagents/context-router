# Auth0 Integration Setup Guide

This guide will help you set up Auth0 authentication for your NestJS GraphQL monolith.

## 🎯 What We've Built

Your application now has:

- ✅ **JWT-based authentication** using Auth0's RS256 tokens
- ✅ **Automatic user syncing** from Auth0 to PostgreSQL (ON_LOGIN strategy)
- ✅ **Protected GraphQL queries/mutations** with `@UseGuards(GqlAuthGuard)`
- ✅ **Clean architecture** with Auth0 infrastructure layer
- ✅ **`me` query** to get current authenticated user
- ✅ **CORS configuration** ready for frontend integration
- ✅ **Prisma schema updated** with `auth0Id` field

## 📋 Step 1: Create Auth0 Account & Application

### 1.1 Sign Up for Auth0

1. Go to [https://auth0.com/signup](https://auth0.com/signup)
2. Create a free account (7,500 monthly active users free)
3. Choose a tenant domain (e.g., `my-app.auth0.com` or `my-app.us.auth0.com`)

### 1.2 Create an API

1. In Auth0 Dashboard, go to **Applications → APIs**
2. Click **+ Create API**
3. Fill in:
   - **Name**: `Context Router API`
   - **Identifier**: `https://context-router-api` (this is your **AUDIENCE**)
   - **Signing Algorithm**: `RS256`
4. Click **Create**

### 1.3 Create a Machine-to-Machine Application

This is needed for the Auth0 Management API (to fetch user info).

1. Go to **Applications → Applications**
2. Click **+ Create Application**
3. Choose:
   - **Name**: `Context Router M2M`
   - **Type**: `Machine to Machine Applications`
4. Click **Create**
5. Select the **Auth0 Management API** from the dropdown
6. Enable the following permissions (scopes):
   - `read:users`
   - `update:users`
   - `read:user_idp_tokens`
7. Click **Authorize**
8. Go to the **Settings** tab and note:
   - **Domain**
   - **Client ID**
   - **Client Secret**

### 1.4 (Optional) Create a Single Page Application

For testing with a frontend:

1. Go to **Applications → Applications**
2. Click **+ Create Application**
3. Choose:
   - **Name**: `Context Router SPA`
   - **Type**: `Single Page Web Applications`
4. In **Settings**:
   - **Allowed Callback URLs**: `http://localhost:3000/callback,http://localhost:5173/callback`
   - **Allowed Logout URLs**: `http://localhost:3000,http://localhost:5173`
   - **Allowed Web Origins**: `http://localhost:3000,http://localhost:5173`
5. Click **Save Changes**

## 📋 Step 2: Configure Environment Variables

### 2.1 Create `.env` file

Copy the example file:

```bash
cp .env.example .env
```

### 2.2 Fill in Auth0 Credentials

Edit your `.env` file with the values from Auth0:

```env
# Auth0 Configuration (from Step 1.3)
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://context-router-api
AUTH0_ISSUER=https://your-tenant.auth0.com/
AUTH0_CLIENT_ID=<Your M2M Client ID>
AUTH0_CLIENT_SECRET=<Your M2M Client Secret>
AUTH0_MANAGEMENT_API_AUDIENCE=https://your-tenant.auth0.com/api/v2/

# JWT Configuration (optional)
JWT_SECRET=your-random-secret-key-here
JWT_EXPIRES_IN=1h

# User Sync Strategy
AUTH0_SYNC_STRATEGY=ON_LOGIN

# CORS Configuration
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

**Important**: Replace `your-tenant.auth0.com` with your actual Auth0 domain!

## 📋 Step 3: Set Up Admin Role (RBAC)

### 3.1 Enable RBAC in Auth0 API

1. Go to **Applications → APIs → Context Router API**
2. Go to **Settings** tab
3. Enable:
   - ✅ **Enable RBAC**
   - ✅ **Add Permissions in the Access Token**
4. Click **Save**

### 3.2 Create Admin Role

1. Go to **User Management → Roles**
2. Click **+ Create Role**
3. Fill in:
   - **Name**: `admin`
   - **Description**: `Administrator with full access`
4. Click **Create**
5. Go to **Permissions** tab
6. Click **Add Permissions**
7. Select your API (`Context Router API`)
8. Add permissions (or skip for now, you can add custom permissions later)

### 3.3 Assign Admin Role to Your User

1. Go to **User Management → Users**
2. Find your user (or create one via **+ Create User**)
3. Click on the user
4. Go to **Roles** tab
5. Click **Assign Roles**
6. Select `admin`
7. Click **Assign**

### 3.4 Create Auth0 Action to Add Roles to JWT

1. Go to **Actions → Flows → Login**
2. Click **+ Custom**
3. Fill in:
   - **Name**: `Add Roles to Token`
   - **Trigger**: `Login / Post Login`
4. Paste this code:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://context-router-api';

  if (event.authorization) {
    // Add roles to access token
    api.accessToken.setCustomClaim(`${namespace}/roles`, event.authorization.roles);

    // Add roles to ID token
    api.idToken.setCustomClaim(`${namespace}/roles`, event.authorization.roles);
  }
};
```

5. Click **Deploy**
6. Go back to **Actions → Flows → Login**
7. Drag your new action into the flow (between Start and Complete)
8. Click **Apply**

## 📋 Step 4: Run the Application

### 4.1 Start Docker Services

```bash
docker compose up --build
```

This will:
- Start PostgreSQL container
- Start NestJS app container
- Run Prisma migrations (adds `auth0_id` column)
- Start the GraphQL server on http://localhost:3000

### 4.2 Verify Migration

Check the logs to ensure the migration ran:

```bash
docker compose logs app | grep "Database connection established"
```

You should see Prisma connected successfully.

## 📋 Step 5: Test Authentication

### 5.1 Get a Test Token

You can get a test token in several ways:

#### Option A: Using Auth0 Dashboard

1. Go to **Applications → APIs → Context Router API**
2. Go to **Test** tab
3. Copy the access token

#### Option B: Using curl (M2M Token)

```bash
curl --request POST \
  --url https://YOUR-TENANT.auth0.com/oauth/token \
  --header 'content-type: application/json' \
  --data '{
    "client_id":"YOUR_M2M_CLIENT_ID",
    "client_secret":"YOUR_M2M_CLIENT_SECRET",
    "audience":"https://context-router-api",
    "grant_type":"client_credentials"
  }'
```

Save the `access_token` from the response.

### 5.2 Test the `me` Query

```bash
# Replace YOUR_TOKEN with the actual token
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "query": "{ me { userId email firstName lastName auth0Id } }"
  }' | jq .
```

**Expected Result**: If this is your first login, a new user will be created automatically and returned:

```json
{
  "data": {
    "me": {
      "userId": "uuid-here",
      "email": "you@example.com",
      "firstName": "Your",
      "lastName": "Name",
      "auth0Id": "auth0|123456..."
    }
  }
}
```

### 5.3 Test Protected Queries

```bash
# This should work with a valid token
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "query": "{ users { userId email firstName lastName } }"
  }' | jq .
```

```bash
# This should fail without a token
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ users { userId email firstName lastName } }"
  }' | jq .
```

**Expected Error**:
```json
{
  "errors": [
    {
      "message": "Unauthorized",
      "extensions": {
        "code": "UNAUTHENTICATED"
      }
    }
  ]
}
```

## 🔧 Troubleshooting

### Issue: "The Auth0 domain is not set"

**Solution**: Make sure you created a `.env` file with `AUTH0_DOMAIN` set.

### Issue: "Invalid token" or "Unauthorized"

**Solution**:
- Check that your token is still valid (they expire after 1 hour by default)
- Verify `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` match your Auth0 API settings
- Ensure the token was issued for the correct audience

### Issue: "Cannot find name 'process'"

**Solution**: Run `npm install` to ensure `@types/node` is installed.

### Issue: Database migration didn't run

**Solution**: Manually run the migration:

```bash
docker compose exec app npx prisma migrate deploy
```

### Issue: User not created on first login

**Solution**:
- Check Auth0Service logs: `docker compose logs app | grep Auth0`
- Verify `AUTH0_SYNC_STRATEGY=ON_LOGIN` in your `.env`
- Check that M2M application has `read:users` permission

## 🎨 GraphQL Playground

Visit http://localhost:3000/graphql in your browser.

Add the HTTP header:
```json
{
  "Authorization": "Bearer YOUR_TOKEN_HERE"
}
```

Try this query:
```graphql
query Me {
  me {
    userId
    email
    firstName
    lastName
    auth0Id
    createdAt
  }
}
```

## 🚀 Next Steps

### Add Role-Based Access Control

You can now use the `@Roles()` decorator:

```typescript
import { Roles } from '@common/decorators/roles.decorator';
import { RolesGuard } from '@common/guards/roles.guard';

@Mutation(() => User)
@UseGuards(GqlAuthGuard, RolesGuard)
@Roles('admin')
async deleteAnyUser(@Args('id') id: string) {
  return this.userService.remove(id);
}
```

You'll need to create a `RolesGuard` that checks the roles from the JWT.

### Extract Roles in JwtStrategy

Update [src/modules/auth/strategies/jwt.strategy.ts](src/modules/auth/strategies/jwt.strategy.ts:42):

```typescript
async validate(payload: any) {
  const user = await this.authService.validateAndSyncUser(payload);

  // Extract roles from custom claim
  const namespace = 'https://context-router-api';
  user.roles = payload[`${namespace}/roles`] || [];

  return user;
}
```

### Frontend Integration

Use a library like:
- **@auth0/auth0-react** (for React)
- **@auth0/auth0-spa-js** (for vanilla JS)
- **@auth0/auth0-angular** (for Angular)

Example with React:
```typescript
import { useAuth0 } from '@auth0/auth0-react';

function MyComponent() {
  const { getAccessTokenSilently } = useAuth0();

  const queryUsers = async () => {
    const token = await getAccessTokenSilently();

    const response = await fetch('http://localhost:3000/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: '{ users { userId email firstName lastName } }',
      }),
    });

    return response.json();
  };
}
```

## 📚 Resources

- [Auth0 Documentation](https://auth0.com/docs)
- [NestJS Passport JWT](https://docs.nestjs.com/recipes/passport#jwt-functionality)
- [GraphQL Authentication Best Practices](https://www.apollographql.com/docs/apollo-server/security/authentication/)
- [Prisma Auth Patterns](https://www.prisma.io/docs/guides/authentication)

## 🎉 You're Done!

Your NestJS GraphQL monolith now has production-ready Auth0 authentication with:
- JWT token validation
- Automatic user syncing
- Protected GraphQL endpoints
- Role-based access control (RBAC) ready
- Clean separation for future microservices migration

Happy coding! 🚀
