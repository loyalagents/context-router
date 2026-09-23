import { PostgresStorageUnitOfWork } from "../../../src/infrastructure/storage/postgres/postgres-unit-of-work";
import {
  StorageConflictError,
  StorageScopeExpiredError,
} from "../../../src/domains/shared/storage/storage-errors";
import type { StorageScope } from "../../../src/domains/shared/storage/storage-unit-of-work";
import { PrismaService } from "../../../src/infrastructure/prisma/prisma.service";
import { getPrismaClient } from "../../setup/test-db";

describe("PostgreSQL transaction capability ownership", () => {
  const db = getPrismaClient();
  let unit: PostgresStorageUnitOfWork;
  let userId: string;
  let definitionId: string;
  beforeEach(async () => {
    unit = new PostgresStorageUnitOfWork(db as unknown as PrismaService);
    userId = (await db.user.create({ data: { email: "uow@example.test" } }))
      .userId;
    definitionId = (
      await db.preferenceDefinition.findFirstOrThrow({
        where: { slug: "system.response_tone", namespace: "GLOBAL" },
      })
    ).id;
  });
  const write = (scope: StorageScope, owner: string, definition: string) =>
    scope.preferences.upsertActive(owner, definition, "casual", null, {
      sourceType: "USER",
    });

  it("commits only after all facets succeed and expires the captured scope", async () => {
    let captured!: StorageScope;
    const row = await unit.run(async (scope) => {
      captured = scope;
      expect(Object.keys(scope.preferences).sort()).toEqual([
        "delete",
        "upsertActive",
        "upsertRejected",
        "upsertSuggested",
      ]);
      expect(Object.keys(scope.definitions).sort()).toEqual([
        "archive",
        "create",
        "update",
      ]);
      expect(Object.keys(scope.audit)).toEqual(["record"]);
      for (const facet of Object.values(scope)) {
        expect(Object.isFrozen(facet)).toBe(true);
        expect(Reflect.get(facet, "prisma")).toBeUndefined();
        expect(Reflect.get(facet, "$transaction")).toBeUndefined();
      }
      const preference = await write(scope, userId, definitionId);
      await scope.audit.record({
        userId,
        subjectSlug: "system.response_tone",
        targetType: "PREFERENCE",
        targetId: preference.result.id,
        eventType: "PREFERENCE_SET",
        actorType: "USER",
        origin: "GRAPHQL",
        correlationId: "uow",
      });
      return preference.result;
    });
    expect(await db.preference.count()).toBe(1);
    expect(
      await db.preferenceAuditEvent.count({ where: { targetId: row.id } }),
    ).toBe(1);
    await expect(write(captured, userId, definitionId)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    await expect(captured.audit.record({} as never)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    expect(await db.preference.count()).toBe(1);
  });

  it("rolls back every facet and preserves arbitrary callback errors including provider-like codes", async () => {
    let captured!: StorageScope;
    const failure = Object.assign(new Error("application sentinel"), {
      code: "P2002",
      cause: { code: "40001" },
    });
    await expect(
      unit.run(async (scope) => {
        captured = scope;
        const preference = await write(scope, userId, definitionId);
        await scope.audit.record({
          userId,
          subjectSlug: "system.response_tone",
          targetType: "PREFERENCE",
          targetId: preference.result.id,
          eventType: "PREFERENCE_SET",
          actorType: "USER",
          origin: "GRAPHQL",
          correlationId: "uow",
        });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.preference.count()).toBe(0);
    expect(await db.preferenceAuditEvent.count()).toBe(0);
    await expect(write(captured, userId, definitionId)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    await unit.run((scope) => write(scope, userId, definitionId));
    expect(await db.preference.count()).toBe(1);
  });

  it("normalizes a real provider unique conflict without its SQL, values or cause", async () => {
    const data = {
      slug: "contract.unique",
      description: "private-value",
      valueType: "STRING" as const,
      scope: "GLOBAL" as const,
      ownerUserId: userId,
    };
    await unit.run((scope) => scope.definitions.create(data));
    const failure = await unit
      .run((scope) => scope.definitions.create(data))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageConflictError);
    expect(failure).toMatchObject({ kind: "unique" });
    expect(String(failure)).not.toMatch(
      /Prisma|SQL|private-value|contract.unique/,
    );
    expect(failure).not.toHaveProperty("cause");
  });
});
