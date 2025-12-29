/**
 * Preference Repository Integration Tests
 *
 * Tests the PreferenceRepository against a real test database.
 * Database is reset between tests via the global beforeEach hook.
 */
import { PreferenceRepository } from '../../src/modules/preferences/preference/preference.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { getPrismaClient } from '../setup/test-db';

describe('PreferenceRepository (integration)', () => {
  let repository: PreferenceRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let testLocationId: string;

  beforeAll(() => {
    // Use the shared test Prisma client
    prisma = getPrismaClient() as unknown as PrismaService;
    repository = new PreferenceRepository(prisma);
  });

  beforeEach(async () => {
    // Create a test user for each test
    const user = await prisma.user.create({
      data: {
        email: 'preftest@example.com',
        firstName: 'Preference',
        lastName: 'Test',
      },
    });
    testUserId = user.userId;

    // Create a test location for location-scoped tests
    const location = await prisma.location.create({
      data: {
        userId: testUserId,
        type: 'HOME',
        label: 'Test Home',
        address: '123 Test St',
      },
    });
    testLocationId = location.locationId;
  });

  describe('create', () => {
    it('should create a global preference', async () => {
      const preference = await repository.create(testUserId, {
        category: 'appearance',
        key: 'theme',
        value: 'dark',
      });

      expect(preference).toBeDefined();
      expect(preference.preferenceId).toBeDefined();
      expect(preference.userId).toBe(testUserId);
      expect(preference.locationId).toBeNull();
      expect(preference.category).toBe('appearance');
      expect(preference.key).toBe('theme');
      expect(preference.value).toBe('dark');
    });

    it('should create a location-scoped preference', async () => {
      const preference = await repository.create(testUserId, {
        category: 'temperature',
        key: 'default',
        value: 72,
        locationId: testLocationId,
      });

      expect(preference.locationId).toBe(testLocationId);
      expect(preference.category).toBe('temperature');
    });

    it('should store complex JSON values', async () => {
      const complexValue = {
        schedule: {
          monday: ['09:00', '17:00'],
          friday: ['10:00', '16:00'],
        },
        enabled: true,
      };

      const preference = await repository.create(testUserId, {
        category: 'schedule',
        key: 'workHours',
        value: complexValue,
      });

      expect(preference.value).toEqual(complexValue);
    });

    it('should store array values', async () => {
      const arrayValue = ['peanuts', 'shellfish', 'dairy'];

      const preference = await repository.create(testUserId, {
        category: 'dietary',
        key: 'allergies',
        value: arrayValue,
      });

      expect(preference.value).toEqual(arrayValue);
    });
  });

  describe('upsert', () => {
    it('should create preference if it does not exist', async () => {
      const preference = await repository.upsert(testUserId, {
        category: 'notifications',
        key: 'email',
        value: true,
      });

      expect(preference.preferenceId).toBeDefined();
      expect(preference.value).toBe(true);
    });

    it('should update preference if it exists', async () => {
      // Create first
      await repository.upsert(testUserId, {
        category: 'notifications',
        key: 'sms',
        value: false,
      });

      // Upsert with same key should update
      const updated = await repository.upsert(testUserId, {
        category: 'notifications',
        key: 'sms',
        value: true,
      });

      expect(updated.value).toBe(true);

      // Verify only one preference exists
      const count = await repository.count(testUserId);
      expect(count).toBe(1);
    });

    it('should handle location-scoped upsert correctly', async () => {
      // Create global preference
      const global = await repository.upsert(testUserId, {
        category: 'temperature',
        key: 'default',
        value: 70,
      });

      // Create location-scoped with same category/key
      const locationScoped = await repository.upsert(testUserId, {
        category: 'temperature',
        key: 'default',
        value: 68,
        locationId: testLocationId,
      });

      // Both should exist as separate preferences
      expect(global.preferenceId).not.toBe(locationScoped.preferenceId);
      expect(global.value).toBe(70);
      expect(locationScoped.value).toBe(68);

      const count = await repository.count(testUserId);
      expect(count).toBe(2);
    });
  });

  describe('findAll', () => {
    it('should return empty array when no preferences exist', async () => {
      const preferences = await repository.findAll(testUserId);
      expect(preferences).toEqual([]);
    });

    it('should return all preferences for user', async () => {
      await repository.create(testUserId, {
        category: 'cat1',
        key: 'key1',
        value: 'val1',
      });

      await repository.create(testUserId, {
        category: 'cat2',
        key: 'key2',
        value: 'val2',
      });

      const preferences = await repository.findAll(testUserId);

      expect(preferences).toHaveLength(2);
    });

    it('should return preferences ordered by createdAt desc', async () => {
      await repository.create(testUserId, {
        category: 'first',
        key: 'key',
        value: 1,
      });

      await repository.create(testUserId, {
        category: 'second',
        key: 'key',
        value: 2,
      });

      const preferences = await repository.findAll(testUserId);

      // Most recent first
      expect(preferences[0].category).toBe('second');
      expect(preferences[1].category).toBe('first');
    });

    it('should not return other users preferences', async () => {
      // Create preference for test user
      await repository.create(testUserId, {
        category: 'mycat',
        key: 'mykey',
        value: 'myval',
      });

      // Create another user and preference
      const otherUser = await prisma.user.create({
        data: {
          email: 'other@example.com',
          firstName: 'Other',
          lastName: 'User',
        },
      });

      await repository.create(otherUser.userId, {
        category: 'othercat',
        key: 'otherkey',
        value: 'otherval',
      });

      // Test user should only see their own
      const preferences = await repository.findAll(testUserId);
      expect(preferences).toHaveLength(1);
      expect(preferences[0].category).toBe('mycat');
    });
  });

  describe('findOne', () => {
    it('should return preference by ID', async () => {
      const created = await repository.create(testUserId, {
        category: 'find',
        key: 'me',
        value: 'found',
      });

      const found = await repository.findOne(created.preferenceId);

      expect(found).toBeDefined();
      expect(found!.preferenceId).toBe(created.preferenceId);
    });

    it('should return null for non-existent ID', async () => {
      const found = await repository.findOne('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByCategory', () => {
    it('should return preferences filtered by category', async () => {
      await repository.create(testUserId, {
        category: 'appearance',
        key: 'theme',
        value: 'dark',
      });

      await repository.create(testUserId, {
        category: 'appearance',
        key: 'fontSize',
        value: 14,
      });

      await repository.create(testUserId, {
        category: 'other',
        key: 'key',
        value: 'val',
      });

      const preferences = await repository.findByCategory(
        testUserId,
        'appearance',
      );

      expect(preferences).toHaveLength(2);
      expect(preferences.every((p) => p.category === 'appearance')).toBe(true);
    });

    it('should return empty array for non-existent category', async () => {
      const preferences = await repository.findByCategory(
        testUserId,
        'nonexistent',
      );
      expect(preferences).toEqual([]);
    });
  });

  describe('findByLocation', () => {
    it('should return preferences for specific location', async () => {
      // Create global preference
      await repository.create(testUserId, {
        category: 'global',
        key: 'key',
        value: 'global-val',
      });

      // Create location-scoped preferences
      await repository.create(testUserId, {
        category: 'local',
        key: 'key1',
        value: 'local-val1',
        locationId: testLocationId,
      });

      await repository.create(testUserId, {
        category: 'local',
        key: 'key2',
        value: 'local-val2',
        locationId: testLocationId,
      });

      const preferences = await repository.findByLocation(
        testUserId,
        testLocationId,
      );

      expect(preferences).toHaveLength(2);
      expect(preferences.every((p) => p.locationId === testLocationId)).toBe(
        true,
      );
    });
  });

  describe('findGlobalPreferences', () => {
    it('should return only global preferences (no locationId)', async () => {
      // Create global preferences
      await repository.create(testUserId, {
        category: 'global1',
        key: 'key',
        value: 'val',
      });

      await repository.create(testUserId, {
        category: 'global2',
        key: 'key',
        value: 'val',
      });

      // Create location-scoped preference
      await repository.create(testUserId, {
        category: 'local',
        key: 'key',
        value: 'val',
        locationId: testLocationId,
      });

      const global = await repository.findGlobalPreferences(testUserId);

      expect(global).toHaveLength(2);
      expect(global.every((p) => p.locationId === null)).toBe(true);
    });
  });

  describe('update', () => {
    it('should update preference value', async () => {
      const created = await repository.create(testUserId, {
        category: 'update',
        key: 'value',
        value: 'original',
      });

      const updated = await repository.update(created.preferenceId, {
        value: 'updated',
      });

      expect(updated.value).toBe('updated');
    });

    it('should update preference category', async () => {
      const created = await repository.create(testUserId, {
        category: 'oldcat',
        key: 'key',
        value: 'val',
      });

      const updated = await repository.update(created.preferenceId, {
        category: 'newcat',
      });

      expect(updated.category).toBe('newcat');
    });

    it('should update preference key', async () => {
      const created = await repository.create(testUserId, {
        category: 'cat',
        key: 'oldkey',
        value: 'val',
      });

      const updated = await repository.update(created.preferenceId, {
        key: 'newkey',
      });

      expect(updated.key).toBe('newkey');
    });

    it('should add locationId to global preference', async () => {
      const created = await repository.create(testUserId, {
        category: 'cat',
        key: 'key',
        value: 'val',
      });

      expect(created.locationId).toBeNull();

      const updated = await repository.update(created.preferenceId, {
        locationId: testLocationId,
      });

      expect(updated.locationId).toBe(testLocationId);
    });

    it('should fail to update non-existent preference', async () => {
      await expect(
        repository.update('non-existent-id', { value: 'test' }),
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete preference and return deleted preference', async () => {
      const created = await repository.create(testUserId, {
        category: 'delete',
        key: 'me',
        value: 'gone',
      });

      const deleted = await repository.delete(created.preferenceId);

      expect(deleted.preferenceId).toBe(created.preferenceId);

      // Verify deletion
      const found = await repository.findOne(created.preferenceId);
      expect(found).toBeNull();
    });

    it('should fail to delete non-existent preference', async () => {
      await expect(repository.delete('non-existent-id')).rejects.toThrow();
    });
  });

  describe('count', () => {
    it('should return 0 when no preferences exist', async () => {
      const count = await repository.count(testUserId);
      expect(count).toBe(0);
    });

    it('should return correct count of preferences', async () => {
      await repository.create(testUserId, {
        category: 'cat1',
        key: 'key',
        value: 1,
      });

      await repository.create(testUserId, {
        category: 'cat2',
        key: 'key',
        value: 2,
      });

      await repository.create(testUserId, {
        category: 'cat3',
        key: 'key',
        value: 3,
        locationId: testLocationId,
      });

      const count = await repository.count(testUserId);
      expect(count).toBe(3);
    });
  });
});
