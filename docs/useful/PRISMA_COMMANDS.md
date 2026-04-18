# Prisma Commands

- Status: useful
- Read when: working on schema, migrations, seeding, or local/test databases
- Source of truth: `apps/backend/package.json`, `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/seed.ts`
- Last reviewed: 2026-04-18

All commands below assume you are in `apps/backend/`.

## Connection Strings

Use placeholders or your local environment. Do not hardcode environment-specific secrets in repo docs.

```bash
# Local Docker Postgres
LOCAL_DB="postgresql://postgres:postgres@localhost:5432/context_router?schema=public"

# Test database
TEST_DB="postgresql://postgres:postgres@localhost:5433/context_router_test?schema=public"

# Cloud or shared database
CLOUD_DB="postgresql://<user>:<password>@<host>:5432/<database>?schema=public"
```

If your local `.env` points to the Docker hostname `postgres`, override `DATABASE_URL` when running Prisma commands from your host machine.

## Local Development

```bash
pnpm prisma:generate
pnpm prisma:migrate
pnpm exec prisma db seed
pnpm exec prisma studio
pnpm exec prisma migrate reset --force
```

Use `pnpm exec prisma migrate dev --name <change_name>` when you need to create a new local migration interactively.

## Test Database

```bash
pnpm test:db:up
pnpm test:db:migrate
pnpm test:e2e:tests-only
pnpm test:db:down
```

For one-off host commands:

```bash
DATABASE_URL="$TEST_DB" pnpm exec prisma migrate deploy
DATABASE_URL="$TEST_DB" pnpm exec prisma studio
```

## Shared or Cloud Database

Only do this when you intend to touch a shared environment.

```bash
DATABASE_URL="$CLOUD_DB" pnpm exec prisma migrate deploy
DATABASE_URL="$CLOUD_DB" pnpm exec prisma db seed
DATABASE_URL="$CLOUD_DB" pnpm exec prisma migrate status
DATABASE_URL="$CLOUD_DB" pnpm exec prisma studio
```

If the environment requires IP allowlisting, use your provider-specific tooling with placeholders:

```bash
curl ifconfig.me
gcloud sql instances patch <instance-name> --authorized-networks="<your-ip>/32"
gcloud sql instances patch <instance-name> --authorized-networks=""
```

## Operational Notes

- `migrate dev` is for local development and may prompt or create migrations.
- `migrate deploy` is for applying existing migrations non-interactively.
- Seeding may create data that cannot be reconstructed later from the database alone. Save any one-time printed values outside the repo if the seed process emits them.
