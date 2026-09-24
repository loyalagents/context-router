import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SqliteDatabase,
  SqliteConnection,
} from "@/infrastructure/storage/sqlite/sqlite-database";
import { SqliteCatalogStorage } from "@/infrastructure/storage/sqlite/sqlite-catalog-storage";
import { seedCatalog } from "@/domains/shared/storage/seed-catalog";
import { fixtureRows } from "./fixture-rows";
import { SqliteAccessHistoryStorage } from "@/infrastructure/storage/sqlite/sqlite-access-history-storage";
import { SqliteAuditHistoryStorage } from "@/infrastructure/storage/sqlite/sqlite-audit-history-storage";
import { SqliteStorageUnitOfWork } from "@/infrastructure/storage/sqlite/sqlite-unit-of-work";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { SqlitePreferenceRepository as PreferenceRepository } from "@/infrastructure/storage/sqlite/sqlite-preference.repository";
import { PreferenceService } from "../../src/modules/preferences/preference/preference.service";
import { SqlitePreferenceDefinitionRepository as PreferenceDefinitionRepository } from "@/infrastructure/storage/sqlite/sqlite-preference-definition.repository";
import { PreferenceDefinitionService } from "../../src/modules/preferences/preference-definition/preference-definition.service";
import { SqlitePreferenceAuditService as PreferenceAuditService } from "@/infrastructure/storage/sqlite/sqlite-preference-audit.service";
import { PreferenceAuditQueryService } from "../../src/modules/preferences/audit/preference-audit-query.service";
import { McpAccessLogService } from "../../src/mcp/access-log/mcp-access-log.service";
import { McpAccessLogQueryService } from "../../src/mcp/access-log/mcp-access-log-query.service";
import { SqliteLocationRepository as LocationRepository } from "@/infrastructure/storage/sqlite/sqlite-location.repository";
import { LocationService } from "../../src/modules/preferences/location/location.service";
import { UserDataResetService } from "../../src/modules/reset/user-data-reset.service";
import { SqlitePermissionGrantRepository as PermissionGrantRepository } from "@/infrastructure/storage/sqlite/sqlite-permission-grant.repository";
import { ResetMemoryMode } from "../../src/modules/reset/models/reset-memory-mode.enum";

import type { MutationContext } from "../../src/modules/preferences/audit/audit.types";
import type { AuditEventInput } from "../../src/modules/preferences/audit/audit.types";
import type {
  FailurePoint,
  StorageContractFixture,
} from "../integration/storage-contracts/storage.contract";

/** SQL/driver details and failpoints belong to this reference fixture, never the shared assertions. */
export async function sqliteStorageFixture(): Promise<StorageContractFixture> {
  const parent = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "local-storage-contract-")),
  );
  const database = SqliteDatabase.bootstrap({
    databaseRoot: path.join(parent, "data"),
    identityRoot: path.join(parent, "identity"),
  });
  const db = fixtureRows(database);
  const prisma = database;
  await seedCatalog(new SqliteCatalogStorage(database));
  let failed: FailurePoint | undefined;
  let beforeFailure: string;
  let reached = false,
    mutationObserved = false;
  const originalConnect = database.connect.bind(database);
  const fingerprint = (c: SqliteConnection) =>
    JSON.stringify(
      [
        "user_preferences",
        "preference_definitions",
        "preference_audit_events",
        "locations",
        "permission_grants",
      ].map((table) => c.all(`SELECT * FROM ${table} ORDER BY rowid`)),
    );
  const connectionSpy = jest
    .spyOn(database, "connect")
    .mockImplementation(() => {
      const c = originalConnect();
      if (failed) {
        const table =
          failed === "audit"
            ? "preference_audit_events"
            : failed === "suggestion-delete"
              ? "user_preferences"
              : failed === "location-delete"
                ? "locations"
                : "permission_grants";
        const operation = failed === "audit" ? "INSERT" : "DELETE";
        const when =
          failed === "suggestion-delete" ? " WHEN OLD.status='SUGGESTED'" : "";
        c.exec(
          `CREATE TEMP TRIGGER contract_failure BEFORE ${operation} ON ${table}${when} BEGIN SELECT RAISE(ABORT,'contract injected failure'); END`,
        );
        for (const method of ["get", "run"] as const) {
          const original = c[method].bind(c);
          jest.spyOn(c, method).mockImplementation((sql: any, values: any) => {
            const selected = String(sql).startsWith(
              operation === "INSERT"
                ? `INSERT INTO ${table}`
                : `DELETE FROM ${table}`,
            );
            const changed = selected && fingerprint(c) !== beforeFailure;
            try {
              return original(sql, values);
            } catch (error) {
              if (selected) {
                reached = true;
                mutationObserved = changed;
              }
              throw error;
            }
          });
        }
      }
      return c;
    });
  const definitions = new PreferenceDefinitionRepository(prisma);
  const preferences = new PreferenceRepository(prisma);
  const audit = new PreferenceAuditService(prisma);
  const service = new PreferenceService(
    preferences,
    new LocationService(new LocationRepository(prisma)),
    definitions,
    new SqliteStorageUnitOfWork(prisma),
  );
  const definitionService = new PreferenceDefinitionService(
    definitions,
    new SqliteStorageUnitOfWork(prisma),
  );
  const reset = new UserDataResetService(
    new SqliteStorageUnitOfWork(prisma),
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
      const c = originalConnect();
      try {
        beforeFailure = fingerprint(c);
      } finally {
        c.close();
      }
      failed = point;
    },
    async failureProof() {
      return { reached, mutationObserved };
    },
    async dispose() {
      connectionSpy.mockRestore();
      fs.rmSync(parent, { recursive: true, force: true });
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
        const attempts = await Promise.allSettled([set(), set()]);
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
      await new McpAccessLogService(
        new SqliteAccessHistoryStorage(prisma),
      ).record({
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
      // Rank every single-filter mismatch ahead of the expected rows, catching missing or post-LIMIT filtering.
      const auditMismatches = [
        { subjectSlug: "other.history" },
        { eventType: "PREFERENCE_DELETED" },
        { targetType: "PREFERENCE_DEFINITION" },
        { origin: "MCP" },
        { actorClientKey: "other" },
      ];
      for (const [index, mismatch] of auditMismatches.entries())
        await db.preferenceAuditEvent.create({
          data: {
            id: `history-z-audit-${index}`,
            userId,
            occurredAt: at,
            correlationId: "history",
            subjectSlug: "contract.history",
            targetType: "PREFERENCE",
            targetId: "contract",
            eventType: "PREFERENCE_SET",
            actorType: "USER",
            origin: "GRAPHQL",
            actorClientKey: "client",
            ...mismatch,
          },
        });
      const accessMismatches = [
        { clientKey: "other" },
        { surface: "RESOURCES_READ" },
        { operationName: "other" },
        { outcome: "DENY" },
      ];
      for (const [index, mismatch] of accessMismatches.entries())
        await db.mcpAccessEvent.create({
          data: {
            id: `history-z-access-${index}`,
            userId,
            occurredAt: at,
            correlationId: "history",
            clientKey: "client",
            surface: "TOOLS_CALL",
            operationName: "history",
            outcome: "SUCCESS",
            latencyMs: 1,
            ...mismatch,
          },
        });
      return {
        userId,
        expectedIds: ["history-2", "history-1", "history-0"],
        audit: (after) =>
          new PreferenceAuditQueryService(
            new SqliteAuditHistoryStorage(prisma),
          ).getHistory(userId, {
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
          new McpAccessLogQueryService(
            new SqliteAccessHistoryStorage(prisma),
          ).getHistory(userId, {
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
