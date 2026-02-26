# User Data Storage Architecture

## Overview
PostgreSQL database with Prisma ORM, stateless JWT authentication via Auth0.

## Core Tables

### `users` table
Primary user identity:
- `userId` (UUID primary key)
- `email` (unique)
- `firstName`, `lastName`
- `createdAt`, `updatedAt`

### `external_identities` table
Links users to authentication providers (Auth0, Google, etc.):
- `provider` + `providerUserId` (unique composite)
- `metadata` (JSONB for provider-specific data)
- Foreign key to `users` with cascade delete

### `locations` table
User locations (HOME, WORK, OTHER):
- `type`, `label`, `address`
- Linked to user via `userId`

### `preferences` table
**Completely flexible** key-value storage:
- `category` (free-form string - e.g., "food", "travel", "notifications")
- `key` (free-form string - e.g., "allergies", "seat_preference")
- `value` (JSONB - accepts any JSON structure)
- Optionally linked to a `locationId` for location-specific preferences
- Unique constraint: `[userId, locationId, category, key]`

## Authentication Flow

1. User authenticates via Auth0 → receives JWT
2. JWT sent in Authorization header to backend
3. Backend validates JWT signature/expiration
4. User lookup by `external_identities` → email fallback → create if not exists
5. User auto-synced on login (configurable: `ON_LOGIN`, `ON_DEMAND`, `BACKGROUND`)
6. Stateless - no server-side sessions

## Key Design Decisions

### Strengths
- **Flexible preferences**: No predefined schema, can store arbitrary user data
- **Multi-provider auth**: External identity pattern supports multiple OAuth providers
- **Cascade deletes**: Deleting user removes all related data
- **Concurrent login safety**: Transaction-based user creation with retry logic

### Considerations
- **No type safety on preferences**: `category`/`key`/`value` are completely free-form
- **EAV pattern**: Preferences use Entity-Attribute-Value model (flexible but can be harder to query)
- **No versioning**: Preference updates overwrite previous values
- **No audit trail**: No history of who changed what when

## Access Patterns

**GraphQL API** (authenticated):
- `user(id)` - Get user by ID (self-access only)
- `updateUser()` - Update user profile
- `preferences` queries/mutations available via PreferenceResolver

**Data isolation**:
- Users can only access their own data
- Location ownership verified on preference operations
- Admin role exists but most admin mutations not yet implemented

## Tech Stack
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Auth Provider**: Auth0
- **API**: NestJS + GraphQL
- **Token Strategy**: JWT (RS256)
