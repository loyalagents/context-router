import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PermissionGrantRepository } from '../../src/modules/permission-grant/permission-grant.repository';
import { getPrismaClient } from '../setup/test-db';

describe('PermissionGrantRepository (integration)', () => {
  let repository: PermissionGrantRepository;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(() => {
    prisma = getPrismaClient() as unknown as PrismaService;
    repository = new PermissionGrantRepository(prisma);
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: 'perm-repo@example.com',
        firstName: 'Perm',
        lastName: 'Repo',
      },
    });
    userId = user.userId;
  });

  describe('upsert', () => {
    it('should create a new permission grant', async () => {
      const grant = await repository.upsert(
        userId,
        'claude',
        'food.*',
        'READ',
        'DENY',
      );

      expect(grant.id).toBeDefined();
      expect(grant.userId).toBe(userId);
      expect(grant.clientKey).toBe('claude');
      expect(grant.target).toBe('food.*');
      expect(grant.action).toBe('READ');
      expect(grant.effect).toBe('DENY');
    });

    it('should update the existing row for the same unique key', async () => {
      const created = await repository.upsert(
        userId,
        'claude',
        'food.*',
        'READ',
        'DENY',
      );

      const updated = await repository.upsert(
        userId,
        'claude',
        'food.*',
        'READ',
        'ALLOW',
      );

      expect(updated.id).toBe(created.id);
      expect(updated.effect).toBe('ALLOW');

      const rows = await repository.findByUserAndClient(userId, 'claude');
      expect(rows).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('should delete the matching grant', async () => {
      await repository.upsert(userId, 'claude', 'food.*', 'READ', 'DENY');

      await repository.remove(userId, 'claude', 'food.*', 'READ');

      const rows = await repository.findByUserAndClient(userId, 'claude');
      expect(rows).toEqual([]);
    });

    it('should not throw when the matching grant does not exist', async () => {
      await expect(
        repository.remove(userId, 'claude', 'food.*', 'READ'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findByUserAndClient', () => {
    it('should return all grants for the given user and client', async () => {
      await repository.upsert(userId, 'claude', 'food.*', 'READ', 'DENY');
      await repository.upsert(userId, 'claude', 'system.*', 'WRITE', 'ALLOW');
      await repository.upsert(userId, 'codex', '*', 'READ', 'DENY');

      const rows = await repository.findByUserAndClient(userId, 'claude');

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.target).sort()).toEqual([
        'food.*',
        'system.*',
      ]);
    });
  });

  describe('findByUserClientAction', () => {
    it('should return only grants for the requested action', async () => {
      await repository.upsert(userId, 'claude', 'food.*', 'READ', 'DENY');
      await repository.upsert(userId, 'claude', 'food.*', 'WRITE', 'ALLOW');

      const rows = await repository.findByUserClientAction(
        userId,
        'claude',
        'READ',
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('READ');
      expect(rows[0].effect).toBe('DENY');
    });
  });

  describe('findMatchingGrants', () => {
    it('should return matching grants ordered from most specific to least specific', async () => {
      await repository.upsert(userId, 'claude', '*', 'READ', 'DENY');
      await repository.upsert(userId, 'claude', 'food.*', 'READ', 'ALLOW');
      await repository.upsert(
        userId,
        'claude',
        'food.french.*',
        'READ',
        'DENY',
      );
      await repository.upsert(
        userId,
        'claude',
        'food.french.wine',
        'READ',
        'ALLOW',
      );

      const rows = await repository.findMatchingGrants(
        userId,
        'claude',
        'READ',
        ['food.french.wine', 'food.french.*', 'food.*', '*'],
      );

      expect(rows.map((row) => row.target)).toEqual([
        'food.french.wine',
        'food.french.*',
        'food.*',
        '*',
      ]);
    });

    it('should order a short exact slug ahead of a same-length wildcard target', async () => {
      await repository.upsert(userId, 'claude', 'a.*', 'READ', 'DENY');
      await repository.upsert(userId, 'claude', 'a.b', 'READ', 'ALLOW');

      const rows = await repository.findMatchingGrants(
        userId,
        'claude',
        'READ',
        ['a.b', 'a.*', '*'],
      );

      expect(rows.map((row) => row.target)).toEqual(['a.b', 'a.*']);
    });
  });

  describe('cascade delete', () => {
    it('should delete grants when the owning user is deleted', async () => {
      await repository.upsert(userId, 'claude', 'food.*', 'READ', 'DENY');

      await prisma.user.delete({ where: { userId } });

      const rows = await repository.findByUser(userId);
      expect(rows).toEqual([]);
    });
  });
});
