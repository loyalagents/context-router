import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
const step03MigrationName = 'step03_20260922_external_identity_issuer';
const migrationPath = join(
  migrationsRoot,
  step03MigrationName,
  'migration.sql',
);
const preStep03MigrationNames = [
  '20251109231540_init',
  '20251110062952_add_locations_and_preferences',
  '20260118013514_slug_suggestion_workflow',
  '20260222033209_add_preference_definitions',
  '20260306000000_namespace_refactor',
  '20260412130000_add_permission_grants',
  '20260418120000_add_preference_audit_events',
  '20260420120000_add_mcp_access_events',
  '20260422120000_expand_mcp_permission_actions',
  '20260501120000_add_preferences_reset_audit_event',
  '20260502120000_profile_slugs_memory',
  '20260502130000_collapse_users_account_identity',
  '20260502140000_add_preference_last_modified_attribution',
  'add_auth0_id_to_users',
  'refactor_to_external_identity',
] as const;
const transitionLock =
  'LOCK TABLE "users", "external_identities" IN ACCESS EXCLUSIVE MODE;';

interface Fixture {
  client: Client;
  schema: string;
}

async function applyPreStep03Migrations(client: Client): Promise<void> {
  for (const migrationName of preStep03MigrationNames) {
    const sql = await readFile(
      join(migrationsRoot, migrationName, 'migration.sql'),
      'utf8',
    );
    await client.query(sql);
  }
}

async function createFixture(): Promise<Fixture> {
  const schema = `step03_fresh_identity_${randomBytes(8).toString('hex')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await applyPreStep03Migrations(client);
    return { client, schema };
  } catch (error) {
    await client.query('RESET search_path').catch(() => undefined);
    await client
      .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .catch(() => undefined);
    await client.end().catch(() => undefined);
    throw error;
  }
}

async function destroyFixture({ client, schema }: Fixture): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.query('RESET search_path').catch(() => undefined);
  await client
    .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    .catch(() => undefined);
  await client.end();
}

async function seedEveryUserOwnedRelation(client: Client): Promise<void> {
  await client.query(`
    INSERT INTO "users" ("user_id", "email", "created_at", "updated_at")
    VALUES ('legacy-user', 'legacy@example.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  await client.query(`
    INSERT INTO "external_identities" (
      "id", "user_id", "provider", "provider_user_id", "metadata",
      "created_at", "updated_at"
    ) VALUES (
      'legacy-identity', 'legacy-user', 'auth0', 'auth0|legacy',
      '{"historical":true}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    INSERT INTO "locations" (
      "location_id", "user_id", "type", "label", "address",
      "created_at", "updated_at"
    ) VALUES (
      'legacy-location', 'legacy-user', 'HOME', 'Home', 'Private',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    INSERT INTO "preference_definitions" (
      "id", "namespace", "slug", "display_name", "description",
      "value_type", "scope", "options", "is_sensitive", "is_core",
      "archived_at", "created_at", "updated_at", "owner_user_id"
    ) VALUES
      (
        'global-definition', 'GLOBAL', 'global.fixture', 'Global',
        'retained global definition', 'STRING', 'GLOBAL', NULL, false, true,
        NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      ),
      (
        'user-definition', 'USER:legacy-user', 'user.fixture', 'User',
        'deleted user definition', 'STRING', 'GLOBAL', NULL, false, false,
        NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'legacy-user'
      )
  `);
  await client.query(`
    INSERT INTO "user_preferences" (
      "id", "user_id", "location_id", "context_key", "definition_id",
      "value", "status", "sourceType", "confidence", "evidence",
      "created_at", "updated_at"
    ) VALUES
      (
        'global-preference', 'legacy-user', NULL, 'GLOBAL',
        'global-definition', '"global value"'::jsonb, 'ACTIVE', 'USER',
        NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ),
      (
        'user-preference', 'legacy-user', NULL, 'GLOBAL',
        'user-definition', '"user value"'::jsonb, 'ACTIVE', 'USER',
        NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
  `);
  await client.query(`
    INSERT INTO "preference_audit_events" (
      "id", "user_id", "subject_slug", "target_type", "target_id",
      "event_type", "actor_type", "origin", "correlation_id"
    ) VALUES (
      'legacy-audit', 'legacy-user', 'global.fixture', 'PREFERENCE',
      'global-preference', 'PREFERENCE_SET', 'USER', 'GRAPHQL',
      'legacy-correlation'
    )
  `);
  await client.query(`
    INSERT INTO "mcp_access_events" (
      "id", "user_id", "client_key", "surface", "operation_name",
      "outcome", "correlation_id", "latency_ms"
    ) VALUES (
      'legacy-access', 'legacy-user', 'claude', 'TOOLS_CALL',
      'preferences/list', 'SUCCESS', 'legacy-access-correlation', 1
    )
  `);
  await client.query(`
    INSERT INTO "permission_grants" (
      "id", "user_id", "client_key", "target", "action", "effect",
      "created_at", "updated_at"
    ) VALUES (
      'legacy-grant', 'legacy-user', 'claude', 'preferences/*', 'READ',
      'ALLOW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
}

async function snapshot(client: Client) {
  const counts = await client.query<{
    table_name: string;
    row_count: number;
  }>(`
    SELECT 'users' AS table_name, COUNT(*)::integer AS row_count FROM "users"
    UNION ALL
    SELECT 'external_identities', COUNT(*)::integer FROM "external_identities"
    UNION ALL
    SELECT 'locations', COUNT(*)::integer FROM "locations"
    UNION ALL
    SELECT 'user_preferences', COUNT(*)::integer FROM "user_preferences"
    UNION ALL
    SELECT 'preference_definitions', COUNT(*)::integer FROM "preference_definitions"
    UNION ALL
    SELECT 'preference_audit_events', COUNT(*)::integer FROM "preference_audit_events"
    UNION ALL
    SELECT 'mcp_access_events', COUNT(*)::integer FROM "mcp_access_events"
    UNION ALL
    SELECT 'permission_grants', COUNT(*)::integer FROM "permission_grants"
    ORDER BY table_name
  `);
  const globals = await client.query(`
    SELECT to_jsonb(definitions) AS value
    FROM "preference_definitions" definitions
    WHERE "owner_user_id" IS NULL
    ORDER BY "id"
  `);
  const issuerColumn = await client.query(`
    SELECT "is_nullable"
    FROM information_schema.columns
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'external_identities'
      AND "column_name" = 'issuer'
  `);
  const indexes = await client.query(`
    SELECT "indexname", "indexdef"
    FROM pg_indexes
    WHERE "schemaname" = current_schema()
      AND "tablename" IN ('users', 'external_identities')
    ORDER BY "indexname"
  `);
  return {
    counts: counts.rows,
    globals: globals.rows,
    issuerColumn: issuerColumn.rows,
    indexes: indexes.rows,
  };
}

describe('fresh external identity migration', () => {
  jest.setTimeout(60_000);

  it('rolls back the entire destructive transition when DDL fails', async () => {
    const fixture = await createFixture();
    try {
      await seedEveryUserOwnedRelation(fixture.client);
      const before = await snapshot(fixture.client);
      const migrationSql = await readFile(migrationPath, 'utf8');
      const failingSql = migrationSql.replace(
        /\nCOMMIT;\s*$/,
        '\nSELECT 1 / 0;\nCOMMIT;\n',
      );

      await expect(fixture.client.query(failingSql)).rejects.toMatchObject({
        code: '22012',
      });
      await fixture.client.query('ROLLBACK');

      expect(await snapshot(fixture.client)).toEqual(before);
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('blocks an old writer while the exact table lock is held', async () => {
    const fixture = await createFixture();
    const writer = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: `step03_old_writer_${fixture.schema}`,
    });
    writer.on('error', () => undefined);
    const observer = new Client({ connectionString: process.env.DATABASE_URL });
    let pendingWrite: Promise<unknown> | undefined;
    try {
      await seedEveryUserOwnedRelation(fixture.client);
      const migrationSql = await readFile(migrationPath, 'utf8');
      expect(migrationSql.indexOf(transitionLock)).toBeGreaterThanOrEqual(0);
      expect(migrationSql.indexOf(transitionLock)).toBeLessThan(
        migrationSql.indexOf('DELETE FROM "user_preferences";'),
      );
      await writer.connect();
      await observer.connect();
      await writer.query(`SET search_path TO "${fixture.schema}", public`);
      await fixture.client.query('BEGIN');
      await fixture.client.query(transitionLock);
      const migratorPid = await fixture.client.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const writerPid = await writer.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );

      pendingWrite = writer.query(`
        INSERT INTO "external_identities" (
          "id", "user_id", "provider", "provider_user_id", "updated_at"
        ) VALUES (
          'blocked-writer', 'legacy-user', 'auth0', 'auth0|blocked',
          CURRENT_TIMESTAMP
        )
      `);
      // Observe the expected termination immediately; assert on the original promise below.
      void pendingWrite.catch(() => undefined);

      let blockers: number[] = [];
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = await observer.query<{ blockers: number[] }>(
          `SELECT pg_blocking_pids($1) AS blockers`,
          [writerPid.rows[0].pid],
        );
        blockers = state.rows[0]?.blockers ?? [];
        if (blockers.includes(migratorPid.rows[0].pid)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blockers).toContain(migratorPid.rows[0].pid);

      await observer.query('SELECT pg_terminate_backend($1)', [
        writerPid.rows[0].pid,
      ]);
      await expect(pendingWrite).rejects.toBeDefined();
      await fixture.client.query('ROLLBACK');
    } finally {
      await fixture.client.query('ROLLBACK').catch(() => undefined);
      await pendingWrite?.catch(() => undefined);
      await writer.end().catch(() => undefined);
      await observer.end().catch(() => undefined);
      await destroyFixture(fixture);
    }
  });

  it('deletes all user-owned rows and preserves global definitions', async () => {
    const fixture = await createFixture();
    try {
      await seedEveryUserOwnedRelation(fixture.client);
      const globalBefore = (await snapshot(fixture.client)).globals;
      await fixture.client.query(await readFile(migrationPath, 'utf8'));

      for (const table of [
        'users',
        'external_identities',
        'locations',
        'user_preferences',
        'preference_audit_events',
        'mcp_access_events',
        'permission_grants',
      ]) {
        const result = await fixture.client.query<{ count: number }>(
          `SELECT COUNT(*)::integer AS count FROM "${table}"`,
        );
        expect(result.rows[0].count).toBe(0);
      }
      const retainedDefinitions = await fixture.client.query<{
        id: string;
        owner_user_id: string | null;
      }>(`
        SELECT "id", "owner_user_id"
        FROM "preference_definitions"
        ORDER BY "id"
      `);
      expect(retainedDefinitions.rows).toContainEqual({
        id: 'global-definition',
        owner_user_id: null,
      });
      expect(
        retainedDefinitions.rows.every(
          ({ owner_user_id }) => owner_user_id === null,
        ),
      ).toBe(true);
      expect((await snapshot(fixture.client)).globals).toEqual(globalBefore);
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('installs required issuer, duplicate email, and exact triple keys', async () => {
    const fixture = await createFixture();
    try {
      await fixture.client.query(await readFile(migrationPath, 'utf8'));
      await fixture.client.query(`
        INSERT INTO "users" ("user_id", "email", "created_at", "updated_at")
        VALUES
          ('fresh-one', 'same@example.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('fresh-two', 'same@example.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('fresh-three', 'same@example.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      await expect(
        fixture.client.query(`
          INSERT INTO "external_identities" (
            "id", "user_id", "provider", "provider_user_id", "updated_at"
          ) VALUES (
            'missing-issuer', 'fresh-one', 'auth0', 'auth0|missing',
            CURRENT_TIMESTAMP
          )
        `),
      ).rejects.toMatchObject({ code: '23502', column: 'issuer' });

      await fixture.client.query(`
        INSERT INTO "external_identities" (
          "id", "user_id", "provider", "issuer", "provider_user_id",
          "updated_at"
        ) VALUES
          (
            'exact-one', 'fresh-one', 'auth0', 'https://tenant-one.test/',
            'shared-subject', CURRENT_TIMESTAMP
          ),
          (
            'other-issuer', 'fresh-two', 'auth0', 'https://tenant-two.test/',
            'shared-subject', CURRENT_TIMESTAMP
          ),
          (
            'other-provider', 'fresh-three', 'example-idp',
            'https://tenant-one.test/', 'shared-subject', CURRENT_TIMESTAMP
          )
      `);
      await expect(
        fixture.client.query(`
          INSERT INTO "external_identities" (
            "id", "user_id", "provider", "issuer", "provider_user_id",
            "updated_at"
          ) VALUES (
            'exact-duplicate', 'fresh-two', 'auth0',
            'https://tenant-one.test/', 'shared-subject', CURRENT_TIMESTAMP
          )
        `),
      ).rejects.toMatchObject({ code: '23505' });

      const state = await snapshot(fixture.client);
      expect(state.issuerColumn).toEqual([{ is_nullable: 'NO' }]);
      expect(
        state.indexes.some(({ indexname }) => indexname === 'users_email_key'),
      ).toBe(false);
      expect(
        state.indexes.some(
          ({ indexname }) =>
            indexname ===
            'external_identities_provider_issuer_provider_user_id_key',
        ),
      ).toBe(true);
    } finally {
      await destroyFixture(fixture);
    }
  });
});
