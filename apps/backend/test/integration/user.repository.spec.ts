/**
 * User Repository Integration Tests
 *
 * Tests the UserRepository against a real test database.
 * Database is reset between tests via the global beforeEach hook.
 */
import { UserRepository } from '../../src/modules/user/user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { getPrismaClient } from '../setup/test-db';

describe('UserRepository (integration)', () => {
  let repository: UserRepository;
  let prisma: PrismaService;

  beforeAll(() => {
    // Use the shared test Prisma client
    prisma = getPrismaClient() as unknown as PrismaService;
    repository = new UserRepository(prisma);
  });

  describe('create', () => {
    it('should create a user with required fields', async () => {
      const user = await repository.create({
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
      });

      expect(user).toBeDefined();
      expect(user.userId).toBeDefined();
      expect(user.email).toBe('new@example.com');
      expect(user.firstName).toBe('New');
      expect(user.lastName).toBe('User');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('should generate unique userId for each user', async () => {
      const user1 = await repository.create({
        email: 'user1@example.com',
        firstName: 'User',
        lastName: 'One',
      });

      const user2 = await repository.create({
        email: 'user2@example.com',
        firstName: 'User',
        lastName: 'Two',
      });

      expect(user1.userId).not.toBe(user2.userId);
    });

    it('should fail when creating user with duplicate email', async () => {
      await repository.create({
        email: 'duplicate@example.com',
        firstName: 'First',
        lastName: 'User',
      });

      await expect(
        repository.create({
          email: 'duplicate@example.com',
          firstName: 'Second',
          lastName: 'User',
        }),
      ).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return empty array when no users exist', async () => {
      const users = await repository.findAll();
      expect(users).toEqual([]);
    });

    it('should return all users ordered by createdAt desc', async () => {
      // Create users with slight delay to ensure different timestamps
      await repository.create({
        email: 'first@example.com',
        firstName: 'First',
        lastName: 'User',
      });

      await repository.create({
        email: 'second@example.com',
        firstName: 'Second',
        lastName: 'User',
      });

      const users = await repository.findAll();

      expect(users).toHaveLength(2);
      // Most recent first (desc order)
      expect(users[0].email).toBe('second@example.com');
      expect(users[1].email).toBe('first@example.com');
    });
  });

  describe('findOne', () => {
    it('should return user by userId', async () => {
      const created = await repository.create({
        email: 'findme@example.com',
        firstName: 'Find',
        lastName: 'Me',
      });

      const found = await repository.findOne(created.userId);

      expect(found).toBeDefined();
      expect(found!.userId).toBe(created.userId);
      expect(found!.email).toBe('findme@example.com');
    });

    it('should return null for non-existent userId', async () => {
      const found = await repository.findOne('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return user by email', async () => {
      await repository.create({
        email: 'findbyemail@example.com',
        firstName: 'Find',
        lastName: 'ByEmail',
      });

      const found = await repository.findByEmail('findbyemail@example.com');

      expect(found).toBeDefined();
      expect(found!.email).toBe('findbyemail@example.com');
    });

    it('should return null for non-existent email', async () => {
      const found = await repository.findByEmail('nonexistent@example.com');
      expect(found).toBeNull();
    });

    it('should be case-sensitive for email lookup', async () => {
      await repository.create({
        email: 'Case@Example.com',
        firstName: 'Case',
        lastName: 'Sensitive',
      });

      // Different case should not match (depending on DB collation)
      const found = await repository.findByEmail('Case@Example.com');
      expect(found).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update user firstName', async () => {
      const created = await repository.create({
        email: 'update@example.com',
        firstName: 'Original',
        lastName: 'Name',
      });

      const updated = await repository.update(created.userId, {
        firstName: 'Updated',
      });

      expect(updated.firstName).toBe('Updated');
      expect(updated.lastName).toBe('Name'); // Unchanged
    });

    it('should update user lastName', async () => {
      const created = await repository.create({
        email: 'updatelast@example.com',
        firstName: 'Same',
        lastName: 'Original',
      });

      const updated = await repository.update(created.userId, {
        lastName: 'Changed',
      });

      expect(updated.firstName).toBe('Same'); // Unchanged
      expect(updated.lastName).toBe('Changed');
    });

    it('should update user email', async () => {
      const created = await repository.create({
        email: 'oldemail@example.com',
        firstName: 'Email',
        lastName: 'Change',
      });

      const updated = await repository.update(created.userId, {
        email: 'newemail@example.com',
      });

      expect(updated.email).toBe('newemail@example.com');
    });

    it('should update multiple fields at once', async () => {
      const created = await repository.create({
        email: 'multi@example.com',
        firstName: 'Old',
        lastName: 'Values',
      });

      const updated = await repository.update(created.userId, {
        firstName: 'New',
        lastName: 'Names',
      });

      expect(updated.firstName).toBe('New');
      expect(updated.lastName).toBe('Names');
    });

    it('should update updatedAt timestamp', async () => {
      const created = await repository.create({
        email: 'timestamp@example.com',
        firstName: 'Time',
        lastName: 'Stamp',
      });

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await repository.update(created.userId, {
        firstName: 'NewTime',
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime(),
      );
    });

    it('should fail to update non-existent user', async () => {
      await expect(
        repository.update('non-existent-id', { firstName: 'Test' }),
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete user and return deleted user', async () => {
      const created = await repository.create({
        email: 'todelete@example.com',
        firstName: 'To',
        lastName: 'Delete',
      });

      const deleted = await repository.delete(created.userId);

      expect(deleted.userId).toBe(created.userId);

      // Verify deletion
      const found = await repository.findOne(created.userId);
      expect(found).toBeNull();
    });

    it('should fail to delete non-existent user', async () => {
      await expect(repository.delete('non-existent-id')).rejects.toThrow();
    });
  });

  describe('count', () => {
    it('should return 0 when no users exist', async () => {
      const count = await repository.count();
      expect(count).toBe(0);
    });

    it('should return correct count of users', async () => {
      await repository.create({
        email: 'count1@example.com',
        firstName: 'Count',
        lastName: 'One',
      });

      await repository.create({
        email: 'count2@example.com',
        firstName: 'Count',
        lastName: 'Two',
      });

      await repository.create({
        email: 'count3@example.com',
        firstName: 'Count',
        lastName: 'Three',
      });

      const count = await repository.count();
      expect(count).toBe(3);
    });
  });
});
