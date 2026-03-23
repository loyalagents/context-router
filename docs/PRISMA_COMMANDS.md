# Prisma Commands Reference

All commands run from `apps/backend/`.

## Connection strings

```bash
# Local (Docker Compose postgres)
LOCAL_DB="postgresql://postgres:postgres@localhost:5432/context_router?schema=public"

# Cloud SQL (direct IP — your IP must be allowlisted)
CLOUD_DB="postgresql://monocontextuser:yfNAi2vN-LXp6ts4H48-@34.135.54.18:5432/monocontext?schema=public"

# Cloud SQL (from inside Cloud Run — unix socket)
# postgresql://monocontextuser:yfNAi2vN-LXp6ts4H48-@localhost/monocontext?schema=public&host=/cloudsql/hai-gcp-representation:us-central1:context-monolith-pg
```

## Allowlist your IP for Cloud SQL

```bash
# Find your IP
curl ifconfig.me

# Add it (keep any existing IPs comma-separated)
gcloud sql instances patch context-monolith-pg \
  --authorized-networks="<your-ip>/32"

# Remove it when done
gcloud sql instances patch context-monolith-pg \
  --authorized-networks=""
```

---

## Local development

If your Prisma config points to the Docker-internal hostname (`postgres`), prefix any command with the localhost connection string:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/context_router?schema=public" pnpm exec prisma <command>
```

```bash
# Apply migrations (interactive, creates new migration if schema changed)
pnpm exec prisma migrate dev

# Apply migrations with a name
pnpm exec prisma migrate dev --name describe_your_change

# Seed the database (creates API keys + users, prints keys to console)
pnpm exec prisma db seed

# Full reset: drop all tables, re-migrate, re-seed
pnpm exec prisma migrate reset --force

# Generate Prisma client (after schema.prisma changes)
pnpm exec prisma generate

# Open Prisma Studio (GUI for browsing data)
pnpm exec prisma studio
```

## Cloud SQL

Prefix any command with the Cloud SQL connection string:

```bash
# Apply pending migrations (non-interactive, safe for production)
DATABASE_URL="$CLOUD_DB" pnpm exec prisma migrate deploy

# Seed (creates workshop groups, users, API keys)
# ⚠️ SAVE THE PRINTED API KEYS — they're hashed in the DB and can't be retrieved
DATABASE_URL="$CLOUD_DB" pnpm exec prisma db seed

# Full reset (DESTRUCTIVE — drops everything, re-migrates, re-seeds)
DATABASE_URL="$CLOUD_DB" pnpm exec prisma migrate reset --force

# Browse cloud data in Prisma Studio
DATABASE_URL="$CLOUD_DB" pnpm exec prisma studio

# Check migration status (which migrations have been applied)
DATABASE_URL="$CLOUD_DB" pnpm exec prisma migrate status
```

---

## Key differences: `migrate dev` vs `migrate deploy`

| | `migrate dev` | `migrate deploy` |
|---|---|---|
| **Use for** | Local development | Production / Cloud SQL |
| **Interactive** | Yes (prompts for name, confirms destructive changes) | No (just applies pending migrations) |
| **Creates migrations** | Yes (if schema drifted) | No (only applies existing ones) |
| **Resets on drift** | May prompt to reset | Fails with an error |

## Seed behavior

- The seed creates API keys with **random hex suffixes** — every run generates new keys
- Users are upserted (safe to re-run), but API keys are **insert-only** (duplicates on re-run)
- If you need fresh keys: `prisma migrate reset --force` (wipes everything + re-seeds)
- There is no way to recover plaintext API keys after seeding — they're SHA-256 hashed

## After deploying to Cloud Run

If the app fails to start because of missing tables:

```bash
# 1. Apply migrations
DATABASE_URL="$CLOUD_DB" pnpm exec prisma migrate deploy

# 2. Seed
DATABASE_URL="$CLOUD_DB" pnpm exec prisma db seed

# 3. Re-deploy or let Cloud Run retry the revision
```
