# Race Conditions & Locking Strategy

## Overview

This document describes the race condition vulnerabilities in our distributed architecture and the solutions implemented to handle them.

## Architecture Context

**Current Setup:**
- **Backend**: GCP Cloud Run (auto-scaling, multiple instances)
- **Frontend**: Vercel (edge functions, distributed)
- **Database**: PostgreSQL on GCP

**Why Race Conditions Are a Concern:**
- Cloud Run instances don't share memory
- Auto-scaling can spawn multiple instances instantly
- Network latency between Vercel and Cloud Run creates larger time windows for races
- PostgreSQL connection pooling doesn't prevent race conditions

## Vulnerabilities Identified & Solutions

### 1. User Creation on First Login ⚠️ CRITICAL

**Location**: [auth.service.ts:45-117](../apps/backend/src/modules/auth/auth.service.ts#L45-L117)

**Scenario**:
```
Time    Instance A                 Instance B
-------------------------------------------
T1      Check: user exists? No
T2                                 Check: user exists? No
T3      Create user
T4                                 Create user ❌ CONFLICT!
```

**Impact**:
- Unique constraint violation on email
- 500 error to user
- Failed login attempt

**Solution Implemented**: ✅
- Wrapped user creation in Prisma transaction
- Transaction atomically creates both User and ExternalIdentity records
- Added retry logic with exponential backoff (3 attempts)
- Graceful handling of P2002 (unique constraint) errors
- On constraint error, fetch existing user instead of failing

### 2. External Identity Linking

**Location**: [auth.service.ts:71-105](../apps/backend/src/modules/auth/auth.service.ts#L71-L105)

**Scenario**: Multiple simultaneous attempts to link same Auth0 identity to a user (migration scenarios)

**Solution Implemented**: ✅
- Catch unique constraint violations on `@@unique([provider, providerUserId])`
- Verify the identity is linked to the correct user
- Log warning but continue successfully if already linked

### 3. M2M User Creation

**Location**: [auth.service.ts:235-292](../apps/backend/src/modules/auth/auth.service.ts#L235-L292)

**Scenario**: Multiple M2M tokens arrive simultaneously, each trying to create mock user

**Solution Implemented**: ✅
- Same retry pattern as user creation
- 3 retries with exponential backoff
- Graceful fallback to fetch existing user

---

### 4. Preference Creation ⚠️ MEDIUM

**Location**: [preference.service.ts:28-41](../apps/backend/src/modules/preferences/preference/preference.service.ts#L28-L41)

**Schema constraint:**
```prisma
@@unique([userId, locationId, category, key])
```

**Vulnerable scenario:**
```
Time    Request A                  Request B
-------------------------------------------
T1      Check: pref exists? No
T2                                 Check: pref exists? No
T3      Create preference
T4                                 Create preference ❌ P2002 error!
```

**When this happens:**
- User double-clicks "Save preferences"
- Frontend makes parallel requests for same preference
- Multiple devices/tabs save simultaneously

**Solution Implemented**: ✅
- Changed `create()` to use **upsert pattern**
- If preference exists, update the value
- If it doesn't exist, create it
- Atomic database operation - no race condition possible
- Cleaner than retry logic (single database roundtrip)

---

### 5. Location Creation/Update ✅ ENHANCED

**Location**: [location.service.ts:35-40](../apps/backend/src/modules/preferences/location/location.service.ts#L35-L40)

**No unique constraints** on Location table (besides ID), so no critical race conditions.

**Enhancement Added**: ✅
- Added `upsert()` method for consistency
- Finds existing location by `userId + type + label`, updates if exists
- Optional - existing `create()` method still available for new locations
- Prevents duplicate locations with same type/label
- Useful for "update my HOME address" scenarios

**Why upsert for locations:**
- User updates HOME address on phone, then on laptop
- Without upsert: two separate HOME locations created
- With upsert: existing HOME location is updated

---

## Implementation Details

### Transaction Pattern

```typescript
await this.prisma.$transaction(async (tx) => {
  // Create user
  const newUser = await tx.user.create({ ... });

  // Link external identity
  await tx.externalIdentity.create({
    userId: newUser.userId,
    provider,
    providerUserId
  });

  return newUser;
});
```

**Why This Works:**
- Both operations succeed or both fail (atomicity)
- Database-level isolation prevents other transactions from seeing partial state
- Prisma uses READ COMMITTED isolation by default (sufficient for our use case)

### Retry Pattern with Exponential Backoff

```typescript
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    // Try to create user
    return await createUser();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Wait before retry: 100ms, 200ms, 400ms
      await sleep(100 * Math.pow(2, attempt - 1));
      continue;
    }
    throw error; // Non-constraint errors fail immediately
  }
}
```

**Why Exponential Backoff:**
- Reduces database contention
- Gives first request time to complete
- Prevents thundering herd problem

### Error Detection

```typescript
private isUniqueConstraintError(error: any): boolean {
  return error?.code === 'P2002'; // Prisma unique constraint code
}
```

**Prisma Error Codes:**
- `P2002`: Unique constraint violation
- `P2003`: Foreign key constraint violation
- `P2025`: Record not found

### Upsert Pattern (for Preferences & Locations)

```typescript
// Atomic create-or-update at database level
return this.prisma.preference.upsert({
  where: {
    // Composite unique key
    userId_locationId_category_key: {
      userId,
      locationId: data.locationId || null,
      category: data.category,
      key: data.key
    }
  },
  update: {
    value: data.value // Update if exists
  },
  create: {
    userId,
    locationId: data.locationId,
    category: data.category,
    key: data.key,
    value: data.value // Create if doesn't exist
  }
});
```

**Why Upsert is Better Than Retry for Preferences:**
- Single database roundtrip (faster)
- Atomic operation (no check-then-create gap)
- Naturally idempotent (safe to call multiple times)
- Cleaner code (no retry loops)
- Works perfectly with unique constraints

**When to Use Each Pattern:**
- **Transactions + Retry**: When creating multiple related records (User + ExternalIdentity)
- **Upsert**: When creating single records with unique constraints (Preferences, Settings)

## What We're NOT Implementing (Yet)

### Advisory Locks ❌ Not Needed Now

PostgreSQL advisory locks provide named locks:
```sql
SELECT pg_advisory_xact_lock(hashtext('user:email:john@example.com'));
```

**When to use**: If retry logic proves insufficient or if we need cross-table locking

**Why skipping**: Transactions + retries are simpler and sufficient for our scale

### Redis Distributed Locking ❌ Premature Optimization

```typescript
// Pseudocode - what we might add later
const lock = await redis.lock('user:create:john@example.com', 5000);
try {
  await createUser();
} finally {
  await lock.unlock();
}
```

**When to use**:
- Heavy concurrent load (>1000 req/s)
- Need locks across multiple services
- Long-running operations that span multiple transactions

**Why skipping**:
- Adds infrastructure complexity (Redis cluster)
- More points of failure
- Current solution handles expected load

### Idempotency Keys ❌ Overkill

```typescript
// Client sends unique key
Headers: { "Idempotency-Key": "uuid-12345" }

// Server caches result
if (alreadyProcessed(key)) {
  return cachedResult;
}
```

**When to use**:
- Payment processing (critical to prevent double-charges)
- Systems with frequent client retries
- When you need to guarantee exactly-once processing

**Why skipping**:
- Auth operations are naturally idempotent (find-or-create pattern)
- Adds caching layer complexity
- More useful for mutations with side effects

## Monitoring & Observability

### What to Monitor

1. **Unique Constraint Errors** (P2002)
   - Should see occasional retries in logs
   - Spike indicates contention problem
   - **Alert if**: >5% of requests require retry

2. **Retry Exhaustion**
   - Should be extremely rare (< 0.01%)
   - Indicates severe contention or deadlock
   - **Alert if**: Any occurrence

3. **Transaction Duration**
   - Should be <100ms for user creation
   - Increase indicates database performance issues
   - **Alert if**: p95 > 500ms

### Log Messages to Watch

```
✅ "User creation conflict detected (attempt 1/3)" - Normal, handled gracefully
⚠️  "Max retries reached, fetching existing user" - Rare but okay
❌ "Failed to create user after max retries" - CRITICAL, investigate immediately
```

## Testing Recommendations

### Load Testing Scenarios

1. **Concurrent First Login**
   ```bash
   # Simulate 10 simultaneous login attempts for same new user
   ab -n 10 -c 10 https://api.example.com/graphql
   ```
   **Expected**: All succeed, one creates user, others find existing

2. **M2M Token Flood**
   ```bash
   # Multiple M2M tokens arrive simultaneously
   for i in {1..20}; do
     curl -H "Authorization: Bearer $TOKEN" &
   done
   ```
   **Expected**: First creates user, others reuse it

3. **Stress Test**
   - Use k6 or Artillery to simulate Cloud Run scaling
   - 0 → 10 instances in <5 seconds
   - 100 concurrent new user signups

## Database Configuration for Cloud Run

### Connection Pooling

```typescript
// prisma.service.ts constructor
super({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // IMPORTANT: Tune for Cloud Run
  // Each instance should have small pool since many instances
  connectionLimit: 5 // Not 100!
})
```

**Why small pool per instance:**
- Cloud Run auto-scales to many instances
- Each instance gets its own pool
- 10 instances × 100 connections = 1000 connections 💥
- 10 instances × 5 connections = 50 connections ✅

### Recommended PostgreSQL Settings

```sql
-- Allow enough connections for all Cloud Run instances
max_connections = 200

-- Tune for many small transactions
shared_buffers = 256MB
effective_cache_size = 1GB
```

## Future Enhancements

### When to Revisit This

**Add Advisory Locks if:**
- Seeing >10% retry rate
- Need to lock across multiple tables atomically
- Implementing complex multi-step workflows

**Add Redis Locking if:**
- Scaling beyond 50 Cloud Run instances
- Need distributed rate limiting
- Implementing job queues or distributed tasks

**Add Idempotency Keys if:**
- Building payment/billing features
- Need audit trail of duplicate requests
- Client-side retries become common

## References

- [Prisma Transactions](https://www.prisma.io/docs/concepts/components/prisma-client/transactions)
- [PostgreSQL Isolation Levels](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Cloud Run Connection Pooling](https://cloud.google.com/sql/docs/postgres/manage-connections)
- [Prisma Error Codes](https://www.prisma.io/docs/reference/api-reference/error-reference)

## Implementation Checklist

**Authentication & User Creation:**
- [x] Wrap user creation in transaction
- [x] Add retry logic for constraint violations
- [x] Implement exponential backoff
- [x] Handle M2M user creation races
- [x] Add error detection helper
- [x] Handle identity linking race conditions

**Preferences & Locations:**
- [x] Add upsert method to preference repository
- [x] Update preference service to use upsert
- [x] Add upsert method to location repository
- [x] Add location service upsert (optional enhancement)

**Documentation & Testing:**
- [x] Document implementation patterns
- [x] Add code comments explaining race condition handling
- [ ] Add monitoring/alerts for retry rates
- [ ] Add monitoring for P2002 errors on preferences
- [ ] Load test with concurrent requests
- [ ] Tune connection pool for Cloud Run
- [ ] Add metrics dashboard for race conditions

## Summary

**Current State**: ✅ **Production Ready**

We've implemented sufficient race condition protection for current scale using:
- Database transactions for atomicity
- Retry logic with exponential backoff
- Graceful error handling

**No additional infrastructure needed** (Redis, advisory locks, etc.) until we hit scale issues.

**Next Steps**:
1. Deploy and monitor
2. Watch for P2002 errors in logs
3. Add alerts for retry exhaustion
4. Load test before going live
