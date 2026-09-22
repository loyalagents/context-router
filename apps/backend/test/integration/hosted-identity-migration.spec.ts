import { createHash, randomBytes } from "crypto";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client, Pool } from "pg";
import { PrismaClient } from "../../src/infrastructure/prisma/generated-client";
import { HostedIdentityAdmissionService } from "../../src/modules/auth/hosted-identity-admission.service";
import { executeHostedIdentityAuditCli } from "../../src/modules/auth/hosted-identity-audit.cli";
import type { HostedIdentityAuditOutput } from "../../src/modules/auth/hosted-identity-audit";
import { parseIdentityLinkClaims } from "../../src/modules/auth/hosted-identity-policy";
import { HostedIdentityRepository } from "../../src/modules/auth/hosted-identity.repository";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/step03_20260922_external_identity_issuer/migration.sql",
);
const ISSUER = "https://tenant.auth0.com/";

interface VerifiedBackup {
  bytes: Buffer;
  digest: string;
  localPath: string;
  serverPath: string;
}

function requireSafeName(value: string, label: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe ${label}`);
  }
  return value;
}

function requireSafeServerPath(value: string): string {
  if (!/^\/tmp\/[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new Error("Unsafe server backup path");
  }
  return value;
}

async function runServerProgram(
  client: Client,
  command: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_./:= >-]+$/.test(command) || command.includes("  ")) {
    throw new Error("Unsafe server backup command");
  }
  await client.query(
    `COPY (SELECT NULL::text WHERE FALSE) TO PROGRAM '${command}'`,
  );
}

async function createVerifiedBackup(
  client: Client,
  schema: string,
  artifactDirectory: string,
  sequence: number,
  serverArtifacts: string[],
): Promise<VerifiedBackup> {
  const identity = await client.query<{
    database: string;
    username: string;
  }>(`
    SELECT current_database() AS "database", current_user AS "username"
  `);
  const database = requireSafeName(identity.rows[0].database, "database name");
  const username = requireSafeName(identity.rows[0].username, "database user");
  const safeSchema = requireSafeName(schema, "schema name");
  const nonce = randomBytes(8).toString("hex");
  const serverPath = requireSafeServerPath(
    `/tmp/context-router-${safeSchema}-${sequence}-${nonce}.dump`,
  );
  serverArtifacts.push(serverPath);

  await runServerProgram(
    client,
    [
      "pg_dump",
      "--no-password",
      "--format=custom",
      "--strict-names",
      "--no-owner",
      "--no-privileges",
      `--schema=${safeSchema}`,
      `--file=${serverPath}`,
      `--dbname=${database}`,
      `--username=${username}`,
    ].join(" "),
  );

  const serverResult = await client.query<{ dump: Buffer }>(
    `SELECT pg_read_binary_file($1) AS "dump"`,
    [serverPath],
  );
  const bytes = serverResult.rows[0]?.dump;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error("PostgreSQL backup artifact is empty");
  }
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("PGDMP");

  const digest = createHash("sha256").update(bytes).digest("hex");
  const localPath = join(artifactDirectory, `schema-backup-${sequence}.dump`);
  await writeFile(localPath, bytes, { mode: 0o600, flag: "wx" });
  const persisted = await readFile(localPath);
  expect(createHash("sha256").update(persisted).digest("hex")).toBe(digest);

  return { bytes: persisted, digest, localPath, serverPath };
}

async function restoreVerifiedBackup(
  client: Client,
  schema: string,
  backup: VerifiedBackup,
  serverArtifacts: string[],
): Promise<void> {
  const identity = await client.query<{
    database: string;
    username: string;
  }>(`
    SELECT current_database() AS "database", current_user AS "username"
  `);
  const database = requireSafeName(identity.rows[0].database, "database name");
  const username = requireSafeName(identity.rows[0].username, "database user");
  const safeSchema = requireSafeName(schema, "schema name");
  const restorePath = requireSafeServerPath(
    `/tmp/context-router-${safeSchema}-restore-${randomBytes(8).toString("hex")}.dump`,
  );
  serverArtifacts.push(restorePath);

  await runServerProgram(client, `rm -f ${backup.serverPath}`);
  const largeObject = await client.query<{ oid: number }>(
    `SELECT lo_from_bytea(0, $1) AS "oid"`,
    [backup.bytes],
  );
  const largeObjectOid = largeObject.rows[0].oid;
  try {
    await client.query(`SELECT lo_export($1, $2)`, [
      largeObjectOid,
      restorePath,
    ]);
  } finally {
    await client.query(`SELECT lo_unlink($1)`, [largeObjectOid]);
  }
  const restoredArtifact = await client.query<{ dump: Buffer }>(
    `SELECT pg_read_binary_file($1) AS "dump"`,
    [restorePath],
  );
  expect(
    createHash("sha256").update(restoredArtifact.rows[0].dump).digest("hex"),
  ).toBe(backup.digest);

  await client.query(`DROP SCHEMA "${safeSchema}" CASCADE`);
  await runServerProgram(
    client,
    [
      "pg_restore",
      "--no-password",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      `--dbname=${database}`,
      `--username=${username}`,
      restorePath,
    ].join(" "),
  );
}

async function captureSchemaState(client: Client, schema: string) {
  const safeSchema = requireSafeName(schema, "schema name");
  const schemaMetadata = await client.query(
    `
        SELECT namespace.nspname AS "name", owner.rolname AS "owner"
        FROM pg_namespace namespace
        JOIN pg_roles owner ON owner.oid = namespace.nspowner
        WHERE namespace.nspname = $1
      `,
    [safeSchema],
  );
  const columns = await client.query(
    `
        SELECT "table_name", "ordinal_position", "column_name", "data_type",
               "udt_name", "is_nullable", "column_default"
        FROM information_schema.columns
        WHERE "table_schema" = $1
        ORDER BY "table_name", "ordinal_position"
      `,
    [safeSchema],
  );
  const indexes = await client.query(
    `
        SELECT "tablename", "indexname", "indexdef"
        FROM pg_indexes
        WHERE "schemaname" = $1
        ORDER BY "tablename", "indexname"
      `,
    [safeSchema],
  );
  const constraints = await client.query(
    `
        SELECT tables.relname AS "tableName", constraints.conname AS "name",
               constraints.contype AS "type",
               pg_get_constraintdef(constraints.oid, true) AS "definition"
        FROM pg_constraint constraints
        JOIN pg_class tables ON tables.oid = constraints.conrelid
        JOIN pg_namespace namespace ON namespace.oid = tables.relnamespace
        WHERE namespace.nspname = $1
        ORDER BY tables.relname, constraints.conname
      `,
    [safeSchema],
  );
  const users = await client.query(
    `SELECT * FROM "${safeSchema}"."users" ORDER BY "user_id"`,
  );
  const identities = await client.query(
    `SELECT * FROM "${safeSchema}"."external_identities" ORDER BY "id"`,
  );
  const ledger = await client.query(
    `SELECT * FROM "${safeSchema}"."_prisma_migrations" ORDER BY "id"`,
  );
  const notes = await client.query(
    `SELECT * FROM "${safeSchema}"."operator_notes" ORDER BY "id"`,
  );

  return {
    schema: schemaMetadata.rows,
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    users: users.rows,
    identities: identities.rows,
    ledger: ledger.rows,
    notes: notes.rows,
  };
}

function scopedDatabaseUrl(schema: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  return url.toString();
}

async function executeAudit(
  intentPath: string,
  databaseUrl: string,
  canaries: string[],
): Promise<HostedIdentityAuditOutput> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await executeHostedIdentityAuditCli(
    [intentPath],
    {
      DATABASE_URL: databaseUrl,
      AUTH0_ISSUER: ISSUER,
      AUTH0_DOMAIN: "tenant.auth0.com",
      AUTH0_LEGACY_ISSUER: ISSUER,
    },
    {
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
    },
  );
  expect(exitCode).toBe(0);
  expect(stderr).toEqual([]);
  expect(stdout).toHaveLength(1);
  for (const canary of canaries) {
    expect(stdout[0]).not.toContain(canary);
    expect(stderr.join("")).not.toContain(canary);
  }
  return JSON.parse(stdout[0]) as HostedIdentityAuditOutput;
}

async function expectAuditFailure(
  intentPath: string,
  databaseUrl: string,
  canaries: string[],
): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await executeHostedIdentityAuditCli(
    [intentPath],
    {
      DATABASE_URL: databaseUrl,
      AUTH0_ISSUER: ISSUER,
      AUTH0_DOMAIN: "tenant.auth0.com",
      AUTH0_LEGACY_ISSUER: ISSUER,
    },
    {
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
    },
  );
  expect(exitCode).toBe(1);
  expect(stdout).toEqual([]);
  expect(stderr).toEqual(["Hosted identity audit failed\n"]);
  for (const canary of canaries) {
    expect(stderr[0]).not.toContain(canary);
  }
}

async function expectAdmissionPasses(
  databaseUrl: string,
  schema: string,
  output: HostedIdentityAuditOutput,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { schema, disposeExternalPool: true }),
  });
  const repository = new HostedIdentityRepository(prisma as never);
  const claims = parseIdentityLinkClaims(output.identityLinkClaims);
  const values: Record<string, unknown> = {
    "auth.auth0.issuer": ISSUER,
    "auth.auth0.legacyIssuer": ISSUER,
    "auth.auth0.identityLinkClaims": claims,
  };
  try {
    const snapshot = await repository.readAdmissionSnapshot(ISSUER);
    expect(snapshot.zeroIdentityUsers.map((user) => user.userId)).toEqual([
      "user-four",
      "user-three",
    ]);
    expect(claims.dispositions).toHaveLength(2);
    await new HostedIdentityAdmissionService(repository, {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        const value = values[key];
        if (value === undefined) throw new Error("missing test configuration");
        return value;
      },
    } as never).verify();
  } finally {
    await prisma.$disconnect();
  }
}

describe("hosted external identity issuer migration", () => {
  it("audits, backs up, restores, re-audits, re-forwards, and admits the exact SQL migration", async () => {
    const migrationSql = await readFile(migrationPath, "utf8");
    const schema = `step03_identity_${randomBytes(8).toString("hex")}`;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "step03-identity-migration-"),
    );
    const artifactDirectory = await realpath(temporaryRoot);
    const intentPath = join(artifactDirectory, "identity-intent.json");
    const databaseUrl = scopedDatabaseUrl(schema);
    const serverArtifacts: string[] = [];

    await chmod(artifactDirectory, 0o700);
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      await client.query(`
        CREATE TABLE "users" (
          "user_id" TEXT NOT NULL PRIMARY KEY,
          "email" TEXT NOT NULL UNIQUE
        )
      `);
      await client.query(`
        CREATE TABLE "external_identities" (
          "id" TEXT NOT NULL,
          "user_id" TEXT NOT NULL,
          "provider" TEXT NOT NULL,
          "provider_user_id" TEXT NOT NULL,
          "metadata" JSONB,
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX "external_identities_provider_provider_user_id_key"
          ON "external_identities"("provider", "provider_user_id")
      `);
      await client.query(`
        CREATE INDEX "external_identities_user_id_idx"
          ON "external_identities"("user_id")
      `);
      await client.query(`
        CREATE INDEX "external_identities_provider_provider_user_id_idx"
          ON "external_identities"("provider", "provider_user_id")
      `);
      await client.query(`
        ALTER TABLE "external_identities"
          ADD CONSTRAINT "external_identities_user_id_fkey"
          FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
          ON DELETE CASCADE ON UPDATE CASCADE
      `);
      await client.query(`
        CREATE TABLE "_prisma_migrations" (
          "id" VARCHAR(36) NOT NULL PRIMARY KEY,
          "checksum" VARCHAR(64) NOT NULL,
          "finished_at" TIMESTAMPTZ,
          "migration_name" VARCHAR(255) NOT NULL,
          "logs" TEXT,
          "rolled_back_at" TIMESTAMPTZ,
          "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "applied_steps_count" INTEGER NOT NULL DEFAULT 0
        )
      `);
      await client.query(`
        CREATE TABLE "operator_notes" (
          "id" INTEGER NOT NULL PRIMARY KEY,
          "payload" JSONB NOT NULL,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        INSERT INTO "users" ("user_id", "email") VALUES
          ('user-one', 'one@example.test'),
          ('user-two', 'two@example.test'),
          ('user-three', 'three@example.test'),
          ('user-four', 'four@example.test')
      `);
      await client.query(`
        INSERT INTO "external_identities" (
          "id", "user_id", "provider", "provider_user_id", "metadata",
          "created_at", "updated_at"
        ) VALUES
          (
            'identity-one', 'user-one', 'auth0', 'auth0|one',
            '{"source":"legacy","nested":{"value":1}}'::jsonb,
            '2025-01-02T03:04:05.123Z', '2025-02-03T04:05:06.456Z'
          ),
          (
            'identity-two', 'user-two', 'google', 'google|two', NULL,
            '2025-03-04T05:06:07.789Z', '2025-04-05T06:07:08.901Z'
          )
      `);
      await client.query(`
        INSERT INTO "_prisma_migrations" (
          "id", "checksum", "finished_at", "migration_name",
          "started_at", "applied_steps_count"
        ) VALUES (
          '00000000-0000-0000-0000-000000000001',
          '${"a".repeat(64)}',
          '2025-01-01T00:01:00Z',
          'historical_fixture_migration',
          '2025-01-01T00:00:00Z',
          1
        )
      `);
      await client.query(`
        INSERT INTO "operator_notes" ("id", "payload", "created_at")
        VALUES (1, '{"scope":"unrelated","preserve":true}'::jsonb,
                '2025-01-01T00:00:00Z')
      `);

      const intent = [
        {
          userId: "user-four",
          email: "four@example.test",
          decision: "link" as const,
          issuer: ISSUER,
          subject: "auth0|four-approved",
        },
        {
          userId: "user-three",
          email: "three@example.test",
          decision: "deny" as const,
        },
      ].sort((left, right) =>
        Buffer.compare(Buffer.from(left.userId), Buffer.from(right.userId)),
      );
      const canaries = intent.flatMap((entry) => [
        entry.userId,
        entry.email,
        ...(entry.decision === "link" ? [entry.subject] : []),
      ]);
      canaries.push("auth0|one", intentPath, databaseUrl);

      const occupiedSubjectIntent = intent.map((entry) =>
        entry.decision === "link" ? { ...entry, subject: "auth0|one" } : entry,
      );
      await writeFile(intentPath, JSON.stringify(occupiedSubjectIntent), {
        mode: 0o600,
      });
      await expectAuditFailure(intentPath, databaseUrl, canaries);

      await writeFile(intentPath, JSON.stringify(intent));

      await chmod(intentPath, 0o644);
      await expectAuditFailure(intentPath, databaseUrl, canaries);
      await chmod(intentPath, 0o600);

      const preMigrationAudit = await executeAudit(
        intentPath,
        databaseUrl,
        canaries,
      );
      expect(preMigrationAudit.counts).toEqual({
        pending: 2,
        consumed: 0,
        link: 1,
        deny: 1,
        total: 2,
      });

      const before = await captureSchemaState(client, schema);
      const backup = await createVerifiedBackup(
        client,
        schema,
        artifactDirectory,
        1,
        serverArtifacts,
      );
      expect((await readFile(backup.localPath)).length).toBe(
        backup.bytes.length,
      );

      await client.query(migrationSql);
      const after = await client.query(`
        SELECT "id", "user_id", "provider", "issuer", "provider_user_id",
               "metadata", "created_at", "updated_at"
        FROM "external_identities"
        ORDER BY "id"
      `);
      expect(after.rows.map(({ issuer: _issuer, ...row }) => row)).toEqual(
        before.identities,
      );
      expect(after.rows.map((row) => row.issuer)).toEqual([
        "urn:context-router:legacy-issuer",
        "urn:context-router:legacy-issuer",
      ]);

      const column = await client.query<{
        is_nullable: string;
        column_default: string | null;
        data_type: string;
      }>(`
        SELECT "is_nullable", "column_default", "data_type"
        FROM information_schema.columns
        WHERE "table_schema" = current_schema()
          AND "table_name" = 'external_identities'
          AND "column_name" = 'issuer'
      `);
      expect(column.rows).toEqual([
        { is_nullable: "NO", column_default: null, data_type: "text" },
      ]);

      const indexes = await client.query<{
        index_name: string;
        is_unique: boolean;
        columns: string[];
      }>(`
        SELECT
          index_class.relname AS "index_name",
          index.indisunique AS "is_unique",
          array_agg(attribute.attname::text ORDER BY key.ordinality)::text[] AS "columns"
        FROM pg_index index
        JOIN pg_class table_class ON table_class.oid = index.indrelid
        JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
        JOIN pg_class index_class ON index_class.oid = index.indexrelid
        JOIN unnest(index.indkey) WITH ORDINALITY AS key(attnum, ordinality)
          ON true
        JOIN pg_attribute attribute
          ON attribute.attrelid = table_class.oid
         AND attribute.attnum = key.attnum
        WHERE namespace.nspname = current_schema()
          AND table_class.relname = 'external_identities'
        GROUP BY index_class.relname, index.indisunique
        ORDER BY index_class.relname
      `);
      const indexByName = new Map<string, (typeof indexes.rows)[number]>(
        indexes.rows.map((index) => [index.index_name, index]),
      );
      expect(
        indexByName.get(
          "external_identities_provider_issuer_provider_user_id_key",
        ),
      ).toEqual({
        index_name: "external_identities_provider_issuer_provider_user_id_key",
        is_unique: true,
        columns: ["provider", "issuer", "provider_user_id"],
      });
      expect(
        indexByName.get(
          "external_identities_provider_issuer_provider_user_id_idx",
        ),
      ).toEqual({
        index_name: "external_identities_provider_issuer_provider_user_id_idx",
        is_unique: false,
        columns: ["provider", "issuer", "provider_user_id"],
      });
      expect(
        indexByName.has("external_identities_provider_provider_user_id_key"),
      ).toBe(false);
      expect(
        indexByName.has("external_identities_provider_provider_user_id_idx"),
      ).toBe(false);
      expect(
        indexByName.get("external_identities_user_id_idx")?.columns,
      ).toEqual(["user_id"]);

      const foreignKey = await client.query<{
        delete_action: string;
        update_action: string;
      }>(`
        SELECT
          fk.confdeltype AS "delete_action",
          fk.confupdtype AS "update_action"
        FROM pg_constraint fk
        JOIN pg_class table_class ON table_class.oid = fk.conrelid
        JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
        WHERE namespace.nspname = current_schema()
          AND table_class.relname = 'external_identities'
          AND fk.conname = 'external_identities_user_id_fkey'
      `);
      expect(foreignKey.rows).toEqual([
        { delete_action: "c", update_action: "c" },
      ]);
      await expectAdmissionPasses(databaseUrl, schema, preMigrationAudit);

      await expect(
        client.query(`
          INSERT INTO "external_identities" (
            "id", "user_id", "provider", "provider_user_id", "updated_at"
          ) VALUES (
            'old-writer', 'user-one', 'auth0', 'auth0|old-writer', CURRENT_TIMESTAMP
          )
        `),
      ).rejects.toMatchObject({ code: "23502", column: "issuer" });
      await client.query(`
        INSERT INTO "external_identities" (
          "id", "user_id", "provider", "issuer", "provider_user_id", "updated_at"
        ) VALUES (
          'post-migration-canary', 'user-one', 'auth0', 'https://other.example/',
          'auth0|post-migration-canary', CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        INSERT INTO "operator_notes" ("id", "payload")
        VALUES (2, '{"postMigrationCanary":true}'::jsonb)
      `);

      await restoreVerifiedBackup(client, schema, backup, serverArtifacts);
      await client.query(`SET search_path TO "${schema}", public`);
      expect(await captureSchemaState(client, schema)).toEqual(before);
      await expect(
        client.query(`SELECT "issuer" FROM "external_identities" LIMIT 1`),
      ).rejects.toMatchObject({ code: "42703" });
      expect(
        await client.query(
          `SELECT COUNT(*)::integer AS "count" FROM "operator_notes"`,
        ),
      ).toMatchObject({ rows: [{ count: 1 }] });

      await client.query("BEGIN");
      try {
        await expect(
          client.query(`
            INSERT INTO "external_identities" (
              "id", "user_id", "provider", "provider_user_id", "updated_at"
            ) VALUES (
              'restored-old-writer', 'user-one', 'auth0',
              'auth0|restored-old-writer', CURRENT_TIMESTAMP
            )
          `),
        ).resolves.toBeDefined();
      } finally {
        await client.query("ROLLBACK");
      }
      expect(await captureSchemaState(client, schema)).toEqual(before);

      const restoredAudit = await executeAudit(
        intentPath,
        databaseUrl,
        canaries,
      );
      expect(restoredAudit).toEqual(preMigrationAudit);
      const freshBackup = await createVerifiedBackup(
        client,
        schema,
        artifactDirectory,
        2,
        serverArtifacts,
      );
      expect(freshBackup.digest).toHaveLength(64);
      expect(await captureSchemaState(client, schema)).toEqual(before);
      await client.query(`
        INSERT INTO "operator_notes" ("id", "payload")
        VALUES (3, '{"secondBackupCanary":true}'::jsonb)
      `);
      await restoreVerifiedBackup(client, schema, freshBackup, serverArtifacts);
      await client.query(`SET search_path TO "${schema}", public`);
      expect(await captureSchemaState(client, schema)).toEqual(before);
      expect(await executeAudit(intentPath, databaseUrl, canaries)).toEqual(
        restoredAudit,
      );

      await client.query(migrationSql);
      await expectAdmissionPasses(databaseUrl, schema, restoredAudit);
      const reforwarded = await client.query(`
        SELECT "id", "issuer"
        FROM "external_identities"
        ORDER BY "id"
      `);
      expect(reforwarded.rows).toEqual([
        { id: "identity-one", issuer: "urn:context-router:legacy-issuer" },
        { id: "identity-two", issuer: "urn:context-router:legacy-issuer" },
      ]);
      await expect(
        client.query(`
          INSERT INTO "external_identities" (
            "id", "user_id", "provider", "provider_user_id", "updated_at"
          ) VALUES (
            'old-writer-after-reforward', 'user-one', 'auth0',
            'auth0|old-writer-after-reforward', CURRENT_TIMESTAMP
          )
        `),
      ).rejects.toMatchObject({ code: "23502", column: "issuer" });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("RESET search_path").catch(() => undefined);
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
      for (const serverPath of serverArtifacts) {
        await runServerProgram(client, `rm -f ${serverPath}`).catch(
          () => undefined,
        );
      }
      await client.end();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
