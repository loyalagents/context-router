import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../src/infrastructure/prisma/prisma.service";
import { PreferenceRepository } from "../../../src/modules/preferences/preference/preference.repository";
import { PreferenceService } from "../../../src/modules/preferences/preference/preference.service";
import { PreferenceDefinitionRepository } from "../../../src/modules/preferences/preference-definition/preference-definition.repository";
import { PreferenceDefinitionService } from "../../../src/modules/preferences/preference-definition/preference-definition.service";
import { PreferenceAuditService } from "../../../src/modules/preferences/audit/preference-audit.service";
import { PreferenceAuditQueryService } from "../../../src/modules/preferences/audit/preference-audit-query.service";
import { McpAccessLogService } from "../../../src/mcp/access-log/mcp-access-log.service";
import { McpAccessLogQueryService } from "../../../src/mcp/access-log/mcp-access-log-query.service";
import { LocationRepository } from "../../../src/modules/preferences/location/location.repository";
import { LocationService } from "../../../src/modules/preferences/location/location.service";
import { UserDataResetService } from "../../../src/modules/reset/user-data-reset.service";
import { PermissionGrantRepository } from "../../../src/modules/permission-grant/permission-grant.repository";
import { ResetMemoryMode } from "../../../src/modules/reset/models/reset-memory-mode.enum";
import { getPrismaClient } from "../../setup/test-db";
import type { MutationContext } from "../../../src/modules/preferences/audit/audit.types";
import type { AuditEventInput } from "../../../src/modules/preferences/audit/audit.types";
import type { FailurePoint, StorageContractFixture } from "./storage.contract";

/** SQL/driver details and failpoints belong to this reference fixture, never the shared assertions. */
export async function postgresStorageFixture(): Promise<StorageContractFixture> {
  const db = getPrismaClient();
  let preferenceReadBarrier: (() => Promise<void>) | undefined;
  const prisma = new Proxy(db, {
    get(target, key) {
      if (key === "$transaction")
        return (callback: (tx: unknown) => Promise<unknown>) =>
          target.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, facet) {
                  if (facet !== "preference")
                    return Reflect.get(transaction, facet);
                  return new Proxy(transaction.preference, {
                    get(delegate, operation) {
                      if (operation !== "findFirst")
                        return Reflect.get(delegate, operation);
                      return async (
                        ...args: Parameters<typeof delegate.findFirst>
                      ) => {
                        const row = await delegate.findFirst(...args);
                        await preferenceReadBarrier?.();
                        return row;
                      };
                    },
                  });
                },
              }),
            ),
          );
      return Reflect.get(target, key);
    },
  }) as unknown as PrismaService;
  const definitions = new PreferenceDefinitionRepository(prisma);
  const preferences = new PreferenceRepository(prisma, definitions);
  const audit = new PreferenceAuditService(prisma);
  const service = new PreferenceService(
    preferences,
    new LocationService(new LocationRepository(prisma)),
    definitions,
    prisma,
    audit,
  );
  const definitionService = new PreferenceDefinitionService(
    definitions,
    prisma,
    audit,
  );
  const reset = new UserDataResetService(
    prisma,
    new ConfigService({ app: { enableDemoReset: true } }),
  );
  const user = await db.user.create({
    data: { email: "storage-contract@example.test" },
  });
  const userId = user.userId;
  const context: MutationContext = {
    actorType: "USER",
    actorClientKey: "contract-client",
    origin: "GRAPHQL",
    correlationId: "contract-correlation",
    sourceType: "USER",
    evidence: { source: "contract" },
  };
  const slug = "system.response_tone";
  const input = {
    slug: "contract.custom",
    description: "Contract definition",
    valueType: "STRING" as const,
    scope: "GLOBAL" as const,
  };
  const set = () =>
    service.setPreference(userId, { slug, value: "casual" }, context);
  const suggest = () =>
    service.suggestPreference(
      userId,
      { slug, value: "professional", confidence: 0.8 },
      context,
    );
  const snapshots = () =>
    Promise.all([
      db.user.findMany({ orderBy: { userId: "asc" } }),
      db.externalIdentity.findMany({ orderBy: { id: "asc" } }),
      db.preference.findMany({ orderBy: { id: "asc" } }),
      db.preferenceDefinition.findMany({ orderBy: { id: "asc" } }),
      db.preferenceAuditEvent.findMany({ orderBy: { id: "asc" } }),
      db.mcpAccessEvent.findMany({ orderBy: { id: "asc" } }),
      db.location.findMany({ orderBy: { locationId: "asc" } }),
      db.permissionGrant.findMany({ orderBy: { id: "asc" } }),
    ]);
  const failures: Record<
    FailurePoint,
    { table: string; operation: string; condition: string }
  > = {
    audit: {
      table: "preference_audit_events",
      operation: "INSERT",
      condition: "true",
    },
    "suggestion-delete": {
      table: "user_preferences",
      operation: "DELETE",
      condition: `OLD.status = 'SUGGESTED'`,
    },
    "location-delete": {
      table: "locations",
      operation: "DELETE",
      condition: "true",
    },
    "grant-delete": {
      table: "permission_grants",
      operation: "DELETE",
      condition: "true",
    },
  };
  const installed: string[] = [];
  // Sequence increments survive rollback, unlike rows written by a failed trigger.
  // A second increment proves earlier transactional writes were visible at failure.
  const fingerprint = `md5(concat(
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM user_preferences t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM preference_definitions t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM preference_audit_events t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY location_id) FROM locations t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM permission_grants t)
  ))`;
  return {
    async prepareMutation(kind) {
      if (kind === "definition-create")
        return () => definitionService.create(input, userId, context);
      if (kind.startsWith("definition-")) {
        const definition = await definitionService.create(
          input,
          userId,
          context,
        );
        return kind === "definition-update"
          ? () =>
              definitionService.update(
                definition.id,
                { description: "changed" },
                userId,
                context,
              )
          : () =>
              definitionService.archiveDefinition(
                definition.id,
                userId,
                context,
              );
      }
      const active = await set();
      if (kind === "set")
        return () =>
          service.setPreference(
            userId,
            { slug, value: "professional" },
            {
              ...context,
              actorType: "MCP_CLIENT",
              actorClientKey: "changed-client",
              origin: "MCP",
              confidence: 0.3,
              evidence: { changed: true },
            },
          );
      if (kind === "delete")
        return () => service.deletePreference(active.id, userId, context);
      const suggestion = await suggest();
      if (!suggestion) throw new Error("Fixture expected a suggestion");
      if (kind === "suggest")
        return () =>
          service.suggestPreference(
            userId,
            {
              slug,
              value: "concise",
              confidence: 0.3,
              evidence: { changed: true },
            },
            {
              ...context,
              actorType: "MCP_CLIENT",
              actorClientKey: "changed-client",
              origin: "MCP",
            },
          );
      return kind === "accept"
        ? () => service.acceptSuggestion(suggestion.id, userId, context)
        : () => service.rejectSuggestion(suggestion.id, userId, context);
    },
    snapshot: snapshots,
    async failAt(point) {
      const { table, operation, condition } = failures[point];
      const [before] = await db.$queryRawUnsafe<Array<{ value: string }>>(
        `SELECT ${fingerprint} AS value`,
      );
      await db.$executeRawUnsafe("CREATE SEQUENCE storage_contract_failure");
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION storage_contract_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN PERFORM nextval('storage_contract_failure'); IF (${fingerprint}) <> '${before.value}' THEN PERFORM nextval('storage_contract_failure'); END IF; RAISE EXCEPTION 'storage contract injected failure'; END IF; RETURN OLD; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER storage_contract_fail BEFORE ${operation} ON "${table}" FOR EACH ROW EXECUTE FUNCTION storage_contract_fail()`,
      );
      installed.push(table);
    },
    async failureProof() {
      const [proof] = await db.$queryRawUnsafe<
        Array<{ last_value: bigint; is_called: boolean }>
      >("SELECT last_value, is_called FROM storage_contract_failure");
      return {
        reached: proof.is_called,
        mutationObserved: proof.is_called && Number(proof.last_value) === 2,
      };
    },
    async dispose() {
      for (const table of installed)
        await db.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS storage_contract_fail ON "${table}"`,
        );
      await db.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS storage_contract_fail()",
      );
      await db.$executeRawUnsafe(
        "DROP SEQUENCE IF EXISTS storage_contract_failure",
      );
    },
    async prepareReset() {
      await set();
      await definitionService.create(input, userId, context);
      await db.externalIdentity.create({
        data: {
          userId,
          provider: "contract",
          issuer: "https://issuer.example.test/",
          providerUserId: "subject",
          metadata: { exact: true },
        },
      });
      await db.location.create({
        data: { userId, type: "HOME", label: "Home", address: "Test address" },
      });
      await db.permissionGrant.create({
        data: {
          userId,
          clientKey: "contract-client",
          target: "*",
          action: "READ",
          effect: "ALLOW",
        },
      });
      await db.mcpAccessEvent.create({
        data: {
          userId,
          clientKey: "contract-client",
          surface: "TOOLS_CALL",
          operationName: "contract",
          outcome: "SUCCESS",
          correlationId: "contract",
          latencyMs: 1,
        },
      });
      return {
        reset: (mode) => reset.resetMyMemory(userId, mode as ResetMemoryMode),
        identity: () =>
          Promise.all([
            db.user.findUnique({ where: { userId } }),
            db.externalIdentity.findMany({
              where: { userId },
              orderBy: { id: "asc" },
            }),
          ]),
      };
    },
    async evidence(evidence) {
      await set();
      const updated = await service.setPreference(
        userId,
        { slug, value: "casual" },
        { ...context, evidence },
      );
      return db.preference.findUniqueOrThrow({ where: { id: updated.id } });
    },
    async definitionOptions(options, update) {
      const definition = await definitions.create({
        ...input,
        slug: `contract.value_${randomUUID().replaceAll("-", "")}`,
        ownerUserId: userId,
        options,
      });
      await definitions.update(definition.id, update);
      return (await definitions.getDefinitionById(definition.id))!.options;
    },
    async archiveAndRecreate() {
      const old = await definitions.create({ ...input, ownerUserId: userId });
      await definitions.archive(old.id);
      const replacement = await definitions.create({
        ...input,
        ownerUserId: userId,
      });
      const archived = await definitions.getDefinitionById(old.id);
      if (!archived) throw new Error("Archived row must remain persisted");
      return {
        oldId: old.id,
        newId: replacement.id,
        archivedAt: archived.archivedAt,
        visibleIds: (await definitions.getAll(userId)).map((row) => row.id),
      };
    },
    async concurrent(kind) {
      if (kind === "preference") {
        preferenceReadBarrier = rendezvous();
        const attempts = await Promise.allSettled([set(), set()]);
        preferenceReadBarrier = undefined;
        return {
          attempts,
          rows: await db.preference.count({ where: { userId } }),
          audits: await db.preferenceAuditEvent.count({ where: { userId } }),
        };
      }
      if (kind === "definition") {
        const wait = rendezvous();
        const original = definitions.isKnownSlug.bind(definitions);
        const spy = jest
          .spyOn(definitions, "isKnownSlug")
          .mockImplementation(async (slug, owner) => {
            const exists = await original(slug, owner);
            if (owner) await wait();
            return exists;
          });
        const attempts = await Promise.allSettled([
          definitionService.create(input, userId, context),
          definitionService.create(input, userId, context),
        ]);
        spy.mockRestore();
        return {
          attempts,
          rows: await db.preferenceDefinition.count({
            where: { ownerUserId: userId },
          }),
          audits: await db.preferenceAuditEvent.count({ where: { userId } }),
        };
      }
      const grants = new PermissionGrantRepository(prisma);
      const wait = rendezvous();
      const upsert = async () => {
        await wait();
        return grants.upsert(userId, "contract-client", "*", "READ", "ALLOW");
      };
      return {
        attempts: await Promise.allSettled([upsert(), upsert()]),
        rows: await db.permissionGrant.count({ where: { userId } }),
      };
    },
    async deleteUser() {
      const globalsBefore = await db.preferenceDefinition.findMany({
        where: { namespace: "GLOBAL" },
        orderBy: { id: "asc" },
      });
      await db.user.delete({ where: { userId } });
      const owned = await Promise.all([
        db.externalIdentity.count({ where: { userId } }),
        db.preference.count({ where: { userId } }),
        db.preferenceDefinition.count({ where: { ownerUserId: userId } }),
        db.preferenceAuditEvent.count({ where: { userId } }),
        db.mcpAccessEvent.count({ where: { userId } }),
        db.location.count({ where: { userId } }),
        db.permissionGrant.count({ where: { userId } }),
      ]);
      return {
        remainingOwnedRows: owned.reduce((sum, count) => sum + count, 0),
        globalDefinitions: await db.preferenceDefinition.count({
          where: { namespace: "GLOBAL" },
        }),
        globalsBefore,
        globalsAfter: await db.preferenceDefinition.findMany({
          where: { namespace: "GLOBAL" },
          orderBy: { id: "asc" },
        }),
      };
    },
    async appendJson(value) {
      const metadata = value as AuditEventInput["metadata"];
      await audit.record({
        userId,
        subjectSlug: "contract.json",
        targetType: "PREFERENCE",
        targetId: "contract",
        eventType: "PREFERENCE_SET",
        ...context,
        metadata,
      });
      await new McpAccessLogService(prisma).record({
        userId,
        clientKey: " client ",
        surface: "TOOLS_CALL",
        operationName: " operation ",
        outcome: "SUCCESS",
        correlationId: " correlation ",
        latencyMs: 1.2,
        requestMetadata: metadata,
      });
      return {
        audit: (
          await db.preferenceAuditEvent.findFirstOrThrow({ where: { userId } })
        ).metadata,
        access: (
          await db.mcpAccessEvent.findFirstOrThrow({ where: { userId } })
        ).requestMetadata,
      };
    },
    async histories() {
      const foreign = await db.user.create({
        data: { email: "history-foreign@example.test" },
      });
      const at = new Date("2026-01-01T12:00:00.000Z");
      // Three matching tied rows, plus one row violating each independent filter.
      const variants = [
        {},
        {},
        {},
        { userId: foreign.userId },
        { correlationId: "other" },
        { occurredAt: new Date(at.getTime() - 1) },
        { occurredAt: new Date(at.getTime() + 1) },
      ];
      for (let index = 0; index < variants.length; index++) {
        const fields = {
          id: `history-${index}`,
          userId,
          occurredAt: at,
          correlationId: "history",
          ...variants[index],
        };
        await db.preferenceAuditEvent.create({
          data: {
            ...fields,
            subjectSlug: "contract.history",
            targetType: "PREFERENCE",
            targetId: "contract",
            eventType: "PREFERENCE_SET",
            actorType: "USER",
            origin: "GRAPHQL",
            actorClientKey: "client",
          },
        });
        await db.mcpAccessEvent.create({
          data: {
            ...fields,
            clientKey: "client",
            surface: "TOOLS_CALL",
            operationName: "history",
            outcome: "SUCCESS",
            latencyMs: 1,
          },
        });
      }
      return {
        userId,
        expectedIds: ["history-2", "history-1", "history-0"],
        audit: (after) =>
          new PreferenceAuditQueryService(prisma).getHistory(userId, {
            first: 2,
            after,
            subjectSlug: " contract. ",
            correlationId: "history",
            actorClientKey: "client",
            eventType: "PREFERENCE_SET",
            targetType: "PREFERENCE",
            origin: "GRAPHQL",
            occurredFrom: at,
            occurredTo: at,
          }),
        access: (after) =>
          new McpAccessLogQueryService(prisma).getHistory(userId, {
            first: 2,
            after,
            clientKey: " client ",
            operationName: " history ",
            correlationId: " history ",
            outcome: "SUCCESS",
            surface: "TOOLS_CALL",
            occurredFrom: at,
            occurredTo: at,
          }),
      };
    },
    async ownership() {
      const foreign = await db.user.create({
        data: { email: "ownership-foreign@example.test" },
      });
      const location = await db.location.create({
        data: { userId, type: "HOME", label: "Home", address: "Home" },
      });
      const global = await definitions.create({
        ...input,
        slug: "contract.shared",
        scope: "LOCATION",
      });
      const personal = await definitions.create({
        ...input,
        slug: "contract.shared",
        scope: "LOCATION",
        ownerUserId: userId,
      });
      const first = await preferences.upsertActive(
        userId,
        global.id,
        "global",
        null,
        { sourceType: "USER" },
      );
      const second = await preferences.upsertActive(
        userId,
        personal.id,
        "personal",
        null,
        { sourceType: "USER" },
      );
      const local = await preferences.upsertActive(
        userId,
        global.id,
        "local",
        location.locationId,
        { sourceType: "USER" },
      );
      // Explicitly distinct timestamps test ordering without adding a tie-break promise.
      for (const [id, seconds] of [
        [first.result.id, 0],
        [second.result.id, 1],
        [local.result.id, 2],
      ] as const)
        await db.preference.update({
          where: { id },
          data: { updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)) },
        });
      return {
        forbidden: [
          () => service.getPreference(first.result.id, foreign.userId),
          () =>
            service.deletePreference(first.result.id, foreign.userId, context),
          () =>
            service.getActivePreferences(foreign.userId, location.locationId),
          () =>
            definitionService.update(
              personal.id,
              { description: "forbidden" },
              foreign.userId,
              context,
            ),
        ],
        visibleIds: (
          await service.getActivePreferences(userId, location.locationId)
        ).map((row) => row.id),
        expectedVisibleIds: [local.result.id, second.result.id],
        allIds: (await preferences.findByStatus(userId, "ACTIVE")).map(
          (row) => row.id,
        ),
        globalIds: (await preferences.findByStatus(userId, "ACTIVE", null)).map(
          (row) => row.id,
        ),
        locationIds: (
          await preferences.findByStatus(userId, "ACTIVE", location.locationId)
        ).map((row) => row.id),
      };
    },
  };
}

/** Both reads complete before either caller may write; timeout makes a broken fixture fail fast. */
function rendezvous(): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  let timer: ReturnType<typeof setTimeout>;
  const both = new Promise<void>((resolve, reject) => {
    release = resolve;
    timer = setTimeout(
      () => reject(new Error("Concurrent contract rendezvous not reached")),
      2_000,
    );
  });
  return async () => {
    if (++arrivals === 2) {
      clearTimeout(timer);
      release();
    }
    await both;
  };
}
