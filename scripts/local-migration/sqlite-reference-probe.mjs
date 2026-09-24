// Bounded CP1 characterization against an explicitly supplied, owned PostgreSQL fixture.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(
  new URL("../../apps/backend/package.json", import.meta.url),
);
const { PrismaClient } = require("./dist/generated/prisma/client.js");
const { PrismaPg } = require("@prisma/adapter-pg");
const {
  PostgresAuditHistoryStorage,
} = require("./dist/infrastructure/storage/postgres/postgres-audit-history-storage.js");
const {
  PostgresPreferenceDefinitionRepository,
} = require("./dist/infrastructure/storage/postgres/postgres-preference-definition.repository.js");
const {
  PostgresIdentityStorage,
} = require("./dist/infrastructure/storage/postgres/postgres-identity-storage.js");
const {
  PostgresCatalogStorage,
} = require("./dist/infrastructure/storage/postgres/postgres-catalog-storage.js");
const url = new URL(process.env.STEP05_REFERENCE_DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.protocol, "postgresql:");
assert.equal(process.env.STEP05_REFERENCE_FIXTURE_OWNED, "yes");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.href }),
});
try {
  const user = await db.user.create({
    data: { email: "synthetic@example.test" },
  });
  const values = [
    "Case.alpha",
    "case.beta",
    "wild%literal",
    "wildXliteral",
    "wild_literal",
    "wildZliteral",
    "slash\\value",
    "slashvalue",
  ];
  await db.preferenceAuditEvent.createMany({
    data: values.map((subjectSlug) => ({
      userId: user.userId,
      subjectSlug,
      targetId: randomUUID(),
      targetType: "PREFERENCE",
      eventType: "PREFERENCE_SET",
      actorType: "USER",
      origin: "GRAPHQL",
      correlationId: "synthetic-reference",
    })),
  });
  const audit = new PostgresAuditHistoryStorage(db);
  const prefix = {};
  for (const value of ["Case", "case", "wild%", "wild_", "slash\\", "", "%"]) {
    prefix[value] = (
      await audit.findPage(user.userId, { subjectSlug: value }, null, 100)
    )
      .map((row) => row.subjectSlug)
      .sort();
  }
  const longPrefix = {};
  for (const [name, value] of [
    ["literal60001", "x".repeat(60_001)],
    ["wildcards60001", "%".repeat(60_001)],
    ["globSpecial60003", "*?[".repeat(20_001)],
  ]) {
    longPrefix[name] = (
      await audit.findPage(user.userId, { subjectSlug: value }, null, 100)
    ).length;
  }
  assert.deepEqual(longPrefix, {
    literal60001: 0,
    wildcards60001: values.length,
    globSpecial60003: 0,
  });
  await assert.rejects(() =>
    audit.findPage(user.userId, { subjectSlug: "bad\0" }, null, 100),
  );
  for (const [prefix, value] of [
    ["literal*?[", "literal*?[rest"],
    ["under\\_", "under_rest"],
    ["slash\\\\", "slash\\rest"],
    ["_x", "😀xmore"],
  ]) {
    const result = await db.$queryRawUnsafe(
      "SELECT $1::text LIKE $2::text AS matches",
      value,
      `${prefix}%`,
    );
    assert.equal(result[0].matches, true);
  }
  const definitions = new PostgresPreferenceDefinitionRepository(db);
  const definition = await definitions.create({
    slug: "probe.options",
    description: "synthetic",
    valueType: "STRING",
    scope: "GLOBAL",
    ownerUserId: user.userId,
    options: null,
  });
  const nullState = async (id) =>
    (
      await db.$queryRawUnsafe(
        "SELECT options IS NULL AS sql_null, jsonb_typeof(options) AS json_type FROM preference_definitions WHERE id=$1",
        id,
      )
    )[0];
  const createNull = await nullState(definition.id);
  const historical = new Date("2001-01-01T00:00:00.000Z");
  await db.preferenceDefinition.update({
    where: { id: definition.id },
    data: { updatedAt: historical },
  });
  const noOp = await definitions.update(definition.id, {});
  assert.equal(noOp.updatedAt.getTime(), historical.getTime());
  await definitions.update(definition.id, { options: { preserved: true } });
  const omitted = await definitions.update(definition.id, {
    description: "changed",
  });
  assert.deepEqual(omitted.options, { preserved: true });
  await definitions.update(definition.id, { options: null });
  const updateNull = await nullState(definition.id);
  const identity = new PostgresIdentityStorage(db);
  await identity.createVerifiedBinding(user.userId, {
    provider: "synthetic",
    issuer: "synthetic-issuer",
    subject: "synthetic-subject",
  });
  const bindingNull = (
    await db.$queryRawUnsafe(
      "SELECT metadata IS NULL AS sql_null, jsonb_typeof(metadata) AS json_type FROM external_identities WHERE user_id=$1",
      user.userId,
    )
  )[0];
  await identity.upsertM2MPrincipal("synthetic-m2m", "initial@example.test");
  const m2mBefore = await db.user.update({
    where: { userId: "synthetic-m2m" },
    data: { updatedAt: historical },
  });
  const m2mAfter = await identity.upsertM2MPrincipal(
    "synthetic-m2m",
    "ignored@example.test",
  );
  assert.equal(m2mAfter.updatedAt.getTime(), m2mBefore.updatedAt.getTime());
  assert.equal(m2mAfter.email, m2mBefore.email);
  const catalog = new PostgresCatalogStorage(db);
  await catalog.createGlobal("probe.catalog", {
    description: "synthetic",
    valueType: "STRING",
    scope: "GLOBAL",
    options: null,
    isSensitive: false,
    isCore: false,
  });
  const catalogDefinition = await catalog.findActiveGlobal("probe.catalog");
  const catalogNull = await nullState(catalogDefinition.id);
  const nested = await db.preferenceDefinition.update({
    where: { id: definition.id },
    data: { options: { kept: 0, omitted: undefined, array: [null] } },
  });
  assert.deepEqual(nested.options, { kept: 0, array: [null] });
  process.stdout.write(
    `${JSON.stringify({ prefix, longPrefix, nulPrefix: "rejected", createNull, updateNull, bindingNull, catalogNull, omittedOptions: "preserved", emptyDefinitionUpdateTimestamp: "preserved-old-sentinel", m2mNoopTimestampAndEmail: "preserved-old-sentinel", nestedUndefined: "omitted" }, null, 2)}\n`,
  );
} finally {
  await db.$disconnect();
}
