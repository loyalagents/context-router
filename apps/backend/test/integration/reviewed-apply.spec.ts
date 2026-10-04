import { ConfigService } from '@nestjs/config';
import { getPrismaClient } from '../setup/test-db';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PostgresStorageUnitOfWork } from '@/infrastructure/storage/postgres/postgres-unit-of-work';
import { PostgresPreferenceRepository } from '@/infrastructure/storage/postgres/postgres-preference.repository';
import { ReviewedSuggestionService } from '@/modules/preferences/document-analysis/reviewed-suggestion.service';

describe('reviewed apply with independent PostgreSQL serializable writers', () => {
  const db = getPrismaClient();
  let userId: string, service: ReviewedSuggestionService;
  beforeEach(async () => {
    userId = (
      await db.user.create({ data: { email: 'reviewed-pg@example.invalid' } })
    ).userId;
    service = new ReviewedSuggestionService(
      new PostgresStorageUnitOfWork(db as unknown as PrismaService),
      new ConfigService({ documentUpload: { maxSuggestions: 25 } }),
    );
  });
  afterEach(() => jest.restoreAllMocks());
  async function proposal() {
    const [item] = await service.prepare(userId, [
      {
        id: 'item',
        slug: 'profile.first_name',
        newValue: 'Synthetic',
        confidence: 0.9,
        sourceSnippet: '',
        wasCorrected: false,
        operation: 'CREATE',
      } as any,
    ]);
    return {
      suggestionId: item.id,
      slug: item.slug,
      operation: item.operation,
      newValue: item.newValue,
      confidence: item.confidence,
      ...item.review,
    };
  }
  it.each(['CREATE', 'UPDATE'])(
    '%s allows only one winner after both writers observe the same reviewed state',
    async (operation) => {
      if (operation === 'UPDATE')
        expect(
          (await service.apply(userId, 'setup', [await proposal()])).results[0]
            .status,
        ).toBe('APPLIED');
      const input = await proposal();
      expect(input.operation).toBe(operation);
      const beforeEvents = await db.preferenceAuditEvent.count();
      let release: () => void,
        reached = 0;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const read = PostgresPreferenceRepository.prototype.findActiveExact;
      jest
        .spyOn(PostgresPreferenceRepository.prototype, 'findActiveExact')
        .mockImplementation(async function (target) {
          const row = await read.call(this, target);
          reached++;
          if (reached === 2) release();
          await barrier;
          return row;
        });
      const results = await Promise.all([
        service.apply(userId, 'writer-a', [{ ...input, newValue: 'Writer A' }]),
        service.apply(userId, 'writer-b', [{ ...input, newValue: 'Writer B' }]),
      ]);
      expect(reached).toBe(2);
      expect(results.map((result) => result.results[0].status).sort()).toEqual([
        'APPLIED',
        'CONFLICT',
      ]);
      expect(
        await db.preference.count({ where: { userId, status: 'ACTIVE' } }),
      ).toBe(1);
      expect(await db.preferenceAuditEvent.count()).toBe(beforeEvents + 1);
      const winner = results.find(
        (result) => result.results[0].status === 'APPLIED',
      ).results[0].preference;
      expect(
        (await db.preference.findUniqueOrThrow({ where: { id: winner.id } }))
          .value,
      ).toEqual(winner.value);
    },
  );
});
