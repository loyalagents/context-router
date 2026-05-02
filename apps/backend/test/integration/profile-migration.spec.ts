import { readFileSync } from 'fs';
import { join } from 'path';
import { getPrismaClient } from '../setup/test-db';

describe('profile slugs migration', () => {
  const prisma = getPrismaClient();
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260502120000_profile_slugs_memory/migration.sql',
    ),
    'utf8',
  );

  it('creates profile definitions and backfills active global profile preferences', () => {
    for (const slug of [
      'profile.full_name',
      'profile.first_name',
      'profile.last_name',
      'profile.email',
      'profile.badge_name',
      'profile.company',
      'profile.title',
    ]) {
      expect(migrationSql).toContain(slug);
    }

    expect(migrationSql).toContain('"context_key"');
    expect(migrationSql).toContain("'GLOBAL'");
    expect(migrationSql).toContain("'ACTIVE'");
    expect(migrationSql).toContain("'IMPORTED'");
    expect(migrationSql).toContain('"sourceType"');
    expect(migrationSql).toContain('"source":"profile_column_migration"');
  });

  it('moves editable names out of users after backfill', () => {
    expect(migrationSql).toContain('DROP COLUMN "first_name"');
    expect(migrationSql).toContain('DROP COLUMN "last_name"');
  });

  it('backfills real rows when executed against pre-profile tables', async () => {
    const migrationStatements = migrationSql
      .split(/;\s*\n/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE "users" (
          "user_id" TEXT PRIMARY KEY,
          "email" TEXT NOT NULL,
          "first_name" TEXT,
          "last_name" TEXT
        ) ON COMMIT DROP
      `);
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE "preference_definitions" (
          "id" TEXT PRIMARY KEY,
          "namespace" TEXT NOT NULL,
          "slug" TEXT NOT NULL,
          "display_name" TEXT,
          "description" TEXT NOT NULL,
          "value_type" "PreferenceValueType" NOT NULL,
          "scope" "PreferenceScope" NOT NULL,
          "options" JSONB,
          "is_sensitive" BOOLEAN NOT NULL,
          "is_core" BOOLEAN NOT NULL,
          "owner_user_id" TEXT,
          "archived_at" TIMESTAMP,
          "created_at" TIMESTAMP NOT NULL,
          "updated_at" TIMESTAMP NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE "user_preferences" (
          "id" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL,
          "location_id" TEXT,
          "context_key" TEXT NOT NULL,
          "definition_id" TEXT NOT NULL,
          "value" JSONB NOT NULL,
          "status" "PreferenceStatus" NOT NULL,
          "sourceType" "SourceType" NOT NULL,
          "confidence" DOUBLE PRECISION,
          "evidence" JSONB,
          "created_at" TIMESTAMP NOT NULL,
          "updated_at" TIMESTAMP NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "users" ("user_id", "email", "first_name", "last_name")
        VALUES
          ('user-with-name', 'alex@example.test', '  Alex  ', '  Rivera  '),
          ('user-with-email-only', 'email-only@example.test', ' ', NULL)
      `);

      for (const statement of migrationStatements) {
        await tx.$executeRawUnsafe(statement);
      }

      const rows = await tx.$queryRawUnsafe<
        Array<{
          user_id: string;
          slug: string;
          value: string;
          context_key: string;
          location_id: string | null;
          status: string;
          sourceType: string;
          confidence: number | null;
          evidence: { source: string };
        }>
      >(`
        SELECT
          p."user_id",
          d."slug",
          p."value" #>> '{}' AS "value",
          p."context_key",
          p."location_id",
          p."status"::TEXT AS "status",
          p."sourceType"::TEXT AS "sourceType",
          p."confidence",
          p."evidence"
        FROM "user_preferences" p
        JOIN "preference_definitions" d ON d."id" = p."definition_id"
        ORDER BY p."user_id", d."slug"
      `);

      expect(rows).toEqual([
        expect.objectContaining({
          user_id: 'user-with-email-only',
          slug: 'profile.email',
          value: 'email-only@example.test',
        }),
        expect.objectContaining({
          user_id: 'user-with-name',
          slug: 'profile.email',
          value: 'alex@example.test',
        }),
        expect.objectContaining({
          user_id: 'user-with-name',
          slug: 'profile.first_name',
          value: 'Alex',
        }),
        expect.objectContaining({
          user_id: 'user-with-name',
          slug: 'profile.full_name',
          value: 'Alex Rivera',
        }),
        expect.objectContaining({
          user_id: 'user-with-name',
          slug: 'profile.last_name',
          value: 'Rivera',
        }),
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({
          context_key: 'GLOBAL',
          location_id: null,
          status: 'ACTIVE',
          sourceType: 'IMPORTED',
          confidence: null,
          evidence: { source: 'profile_column_migration' },
        });
      }

      const userColumns = await tx.$queryRawUnsafe<
        Array<{ column_name: string }>
      >(`
        SELECT "column_name"
        FROM information_schema.columns
        WHERE "table_schema" = (
          SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()
        )
          AND "table_name" = 'users'
        ORDER BY "column_name"
      `);

      expect(userColumns.map((column) => column.column_name)).toEqual([
        'email',
        'user_id',
      ]);
    });
  });
});
