import { getPrismaClient } from '../setup/test-db';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PostgresStorageUnitOfWork } from '@/infrastructure/storage/postgres/postgres-unit-of-work';
import { HistoryClearService } from '@/modules/preferences/audit/history-clear.service';
import { eventSensitivity } from '@/modules/preferences/audit/event-sensitivity';
import { buildPreferenceAuditSnapshot } from '@/modules/preferences/audit/snapshot-builders';
import { PostgresPreferenceDefinitionRepository } from '@/infrastructure/storage/postgres/postgres-preference-definition.repository';
import { StorageConflictError } from '@/domains/shared/storage/storage-errors';

describe('PostgreSQL history snapshots and clear ordering', () => {
  const db = getPrismaClient();
  let uow: PostgresStorageUnitOfWork, userId: string, definitionId: string;
  beforeEach(async () => {
    uow = new PostgresStorageUnitOfWork(db as unknown as PrismaService);
    userId = (
      await db.user.create({ data: { email: 'ui-history@example.invalid' } })
    ).userId;
    definitionId = (
      await db.preferenceDefinition.findFirstOrThrow({
        where: { slug: 'profile.first_name', namespace: 'GLOBAL' },
      })
    ).id;
  });
  const audit = (correlationId: string) => ({
    userId,
    subjectSlug: 'profile.first_name',
    targetType: 'PREFERENCE' as const,
    targetId: 'synthetic',
    eventType: 'PREFERENCE_SET' as const,
    actorType: 'USER' as const,
    origin: 'GRAPHQL' as const,
    correlationId,
  });
  async function append(correlationId: string) {
    await db.$transaction(async (tx) => {
      await tx.preferenceAuditEvent.create({ data: audit(correlationId) });
      await tx.mcpAccessEvent.create({
        data: {
          userId,
          clientKey: 'synthetic',
          surface: 'TOOLS_CALL',
          operationName: 'synthetic',
          outcome: 'SUCCESS',
          correlationId,
          latencyMs: 1,
        },
      });
    });
  }
  it('both deletes share one serializable snapshot while an independent append commits between them', async () => {
    await append('before');
    const run = uow.serializable.bind(uow);
    let calls = 0;
    jest.spyOn(uow, 'serializable').mockImplementation((callback) => {
      calls++;
      return run((scope) =>
        callback({
          ...scope,
          reset: {
            ...scope.reset,
            deleteAuditEvents: async (owner) => {
              const count = await scope.reset.deleteAuditEvents(owner);
              await append('concurrent');
              return count;
            },
          },
        }),
      );
    });
    const before = await db.user.findMany();
    expect(
      await new HistoryClearService(uow).clear(userId, 'CLEAR HISTORY'),
    ).toEqual({
      status: 'CLEARED',
      preferenceAuditEventsDeleted: 1,
      mcpAccessEventsDeleted: 1,
    });
    expect(calls).toBe(1);
    expect(
      (await db.preferenceAuditEvent.findMany()).map(
        (event) => event.correlationId,
      ),
    ).toEqual(['concurrent']);
    expect(
      (await db.mcpAccessEvent.findMany()).map((event) => event.correlationId),
    ).toEqual(['concurrent']);
    expect(await db.user.findMany()).toEqual(before);
  });
  it('second-delete failure restores both streams and a known serialization rollback is distinct from uncertainty', async () => {
    await append('before');
    const before = [
      await db.preferenceAuditEvent.findMany(),
      await db.mcpAccessEvent.findMany(),
    ];
    const run = uow.serializable.bind(uow);
    jest.spyOn(uow, 'serializable').mockImplementation((callback) =>
      run((scope) =>
        callback({
          ...scope,
          reset: {
            ...scope.reset,
            deleteAccessEvents: async () => {
              throw new Error('synthetic failure');
            },
          },
        }),
      ),
    );
    expect(
      await new HistoryClearService(uow).clear(userId, 'CLEAR HISTORY'),
    ).toEqual({ status: 'UNCERTAIN' });
    expect([
      await db.preferenceAuditEvent.findMany(),
      await db.mcpAccessEvent.findMany(),
    ]).toEqual(before);
    jest
      .spyOn(uow, 'serializable')
      .mockRejectedValue(new StorageConflictError('serialization'));
    expect(
      await new HistoryClearService(uow).clear(userId, 'CLEAR HISTORY'),
    ).toEqual({ status: 'ROLLED_BACK' });
  });
  it('reports an actual PostgreSQL serialization rollback once when the second stream changes after the clear snapshot', async () => {
    await append('before');
    const run = uow.serializable.bind(uow);
    let attempts = 0;
    jest.spyOn(uow, 'serializable').mockImplementation((callback) => {
      attempts++;
      return run((scope) =>
        callback({
          ...scope,
          reset: {
            ...scope.reset,
            deleteAuditEvents: async (owner) => {
              const count = await scope.reset.deleteAuditEvents(owner);
              await db.mcpAccessEvent.updateMany({
                where: { userId },
                data: { latencyMs: 2 },
              });
              return count;
            },
          },
        }),
      );
    });
    expect(
      await new HistoryClearService(uow).clear(userId, 'CLEAR HISTORY'),
    ).toEqual({ status: 'ROLLED_BACK' });
    expect(attempts).toBe(1);
    expect(await db.preferenceAuditEvent.count()).toBe(1);
    expect(await db.mcpAccessEvent.count()).toBe(1);
    expect((await db.mcpAccessEvent.findFirstOrThrow()).latencyMs).toBe(2);
  });
  it('captures the definition version observed inside the mutation, retaining it through a concurrent sensitivity change', async () => {
    await db.preferenceDefinition.update({
      where: { id: definitionId },
      data: { isSensitive: true },
    });
    let witnessed = false;
    const read =
      PostgresPreferenceDefinitionRepository.prototype.getDefinitionById;
    jest
      .spyOn(
        PostgresPreferenceDefinitionRepository.prototype,
        'getDefinitionById',
      )
      .mockImplementation(async function (id) {
        const observed = await read.call(this, id);
        witnessed = true;
        await db.preferenceDefinition.update({
          where: { id },
          data: { isSensitive: false },
        });
        return observed;
      });
    await uow.run(async (scope) => {
      const value = await scope.preferences.upsertActive(
        userId,
        definitionId,
        'Synthetic',
        null,
        { sourceType: 'USER' },
      );
      await scope.audit.record({
        ...audit('observed'),
        targetId: value.result.id,
        afterState: buildPreferenceAuditSnapshot(value.result),
      });
    });
    expect(witnessed).toBe(true);
    expect(
      eventSensitivity(
        (await db.preferenceAuditEvent.findFirstOrThrow()).metadata,
      ),
    ).toBe('SENSITIVE');
    expect(
      (
        await db.preferenceDefinition.findUniqueOrThrow({
          where: { id: definitionId },
        })
      ).isSensitive,
    ).toBe(false);
  });
  afterEach(() => jest.restoreAllMocks());
});
