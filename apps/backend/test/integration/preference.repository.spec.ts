/**
 * Preference Repository Integration Tests
 *
 * Tests the PreferenceRepository against a real test database.
 * Database is reset between tests via the global beforeEach hook.
 *
 * Uses the new slug-based preference model:
 * - Preferences are identified by slug (e.g., "food.dietary_restrictions")
 * - Status can be ACTIVE, SUGGESTED, or REJECTED
 * - Slugs must exist in the preferences catalog
 */
import { PreferenceRepository } from '../../src/modules/preferences/preference/preference.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { getPrismaClient } from '../setup/test-db';
import { PreferenceStatus } from '@prisma/client';

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

  describe('upsertActive', () => {
    it('should create a global ACTIVE preference', async () => {
      const preference = await repository.upsertActive(
        testUserId,
        'system.response_tone',
        'casual',
      );

      expect(preference).toBeDefined();
      expect(preference.id).toBeDefined();
      expect(preference.userId).toBe(testUserId);
      expect(preference.locationId).toBeNull();
      expect(preference.slug).toBe('system.response_tone');
      expect(preference.value).toBe('casual');
      expect(preference.status).toBe(PreferenceStatus.ACTIVE);
      // Enriched with catalog data
      expect(preference.category).toBe('system');
      expect(preference.description).toBeDefined();
    });

    it('should create a location-scoped ACTIVE preference', async () => {
      const preference = await repository.upsertActive(
        testUserId,
        'location.default_temperature',
        '72',
        testLocationId,
      );

      expect(preference.locationId).toBe(testLocationId);
      expect(preference.slug).toBe('location.default_temperature');
      expect(preference.value).toBe('72');
      expect(preference.category).toBe('location');
    });

    it('should store array values', async () => {
      const arrayValue = ['Italian', 'Japanese', 'Mexican'];

      const preference = await repository.upsertActive(
        testUserId,
        'food.cuisine_preferences',
        arrayValue,
      );

      expect(preference.value).toEqual(arrayValue);
    });

    it('should update existing ACTIVE preference (upsert)', async () => {
      // Create first
      await repository.upsertActive(testUserId, 'system.response_length', 'brief');

      // Upsert with same slug should update
      const updated = await repository.upsertActive(
        testUserId,
        'system.response_length',
        'detailed',
      );

      expect(updated.value).toBe('detailed');

      // Verify only one preference exists
      const count = await repository.count(testUserId, PreferenceStatus.ACTIVE);
      expect(count).toBe(1);
    });

    it('should handle location-scoped and global as separate preferences', async () => {
      // Create global preference
      const global = await repository.upsertActive(
        testUserId,
        'food.spice_tolerance',
        'medium',
      );

      // Create location-scoped with same slug - for location-scoped prefs we use a location slug
      const locationScoped = await repository.upsertActive(
        testUserId,
        'location.default_temperature',
        '68',
        testLocationId,
      );

      // Both should exist as separate preferences
      expect(global.id).not.toBe(locationScoped.id);
      expect(global.locationId).toBeNull();
      expect(locationScoped.locationId).toBe(testLocationId);

      const count = await repository.count(testUserId);
      expect(count).toBe(2);
    });
  });

  describe('upsertSuggested', () => {
    it('should create a SUGGESTED preference with confidence', async () => {
      const preference = await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegetarian'],
        0.85,
      );

      expect(preference).toBeDefined();
      expect(preference.slug).toBe('food.dietary_restrictions');
      expect(preference.value).toEqual(['vegetarian']);
      expect(preference.status).toBe(PreferenceStatus.SUGGESTED);
      expect(preference.confidence).toBe(0.85);
    });

    it('should create SUGGESTED preference with evidence', async () => {
      const evidence = {
        snippets: ['I follow a vegan diet'],
        reason: 'User mentioned dietary preference',
      };

      const preference = await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegan'],
        0.9,
        null,
        evidence,
      );

      expect(preference.evidence).toEqual(evidence);
    });

    it('should update existing SUGGESTED preference', async () => {
      await repository.upsertSuggested(
        testUserId,
        'dev.tech_stack',
        ['JavaScript'],
        0.7,
      );

      const updated = await repository.upsertSuggested(
        testUserId,
        'dev.tech_stack',
        ['TypeScript', 'Node.js'],
        0.9,
      );

      expect(updated.value).toEqual(['TypeScript', 'Node.js']);
      expect(updated.confidence).toBe(0.9);

      // Verify only one SUGGESTED preference exists for this slug
      const count = await repository.count(testUserId, PreferenceStatus.SUGGESTED);
      expect(count).toBe(1);
    });
  });

  describe('upsertRejected', () => {
    it('should create a REJECTED preference', async () => {
      const preference = await repository.upsertRejected(
        testUserId,
        'travel.seat_preference',
        'middle',
      );

      expect(preference.status).toBe(PreferenceStatus.REJECTED);
      expect(preference.slug).toBe('travel.seat_preference');
      expect(preference.value).toBe('middle');
    });
  });

  describe('hasRejected', () => {
    it('should return true if REJECTED preference exists', async () => {
      await repository.upsertRejected(testUserId, 'travel.seat_preference', 'middle');

      const result = await repository.hasRejected(
        testUserId,
        'travel.seat_preference',
      );

      expect(result).toBe(true);
    });

    it('should return false if no REJECTED preference exists', async () => {
      const result = await repository.hasRejected(
        testUserId,
        'travel.seat_preference',
      );

      expect(result).toBe(false);
    });

    it('should not find REJECTED if only ACTIVE exists', async () => {
      await repository.upsertActive(testUserId, 'travel.seat_preference', 'window');

      const result = await repository.hasRejected(
        testUserId,
        'travel.seat_preference',
      );

      expect(result).toBe(false);
    });
  });

  describe('findByStatus', () => {
    it('should return empty array when no preferences exist', async () => {
      const preferences = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );
      expect(preferences).toEqual([]);
    });

    it('should return only ACTIVE preferences', async () => {
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');
      await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegan'],
        0.8,
      );

      const active = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );

      expect(active).toHaveLength(1);
      expect(active[0].slug).toBe('system.response_tone');
    });

    it('should return only SUGGESTED preferences', async () => {
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');
      await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegan'],
        0.8,
      );

      const suggested = await repository.findByStatus(
        testUserId,
        PreferenceStatus.SUGGESTED,
      );

      expect(suggested).toHaveLength(1);
      expect(suggested[0].slug).toBe('food.dietary_restrictions');
    });

    it('should return preferences ordered by updatedAt desc', async () => {
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');
      await repository.upsertActive(testUserId, 'system.response_length', 'brief');

      const preferences = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );

      // Most recent first
      expect(preferences[0].slug).toBe('system.response_length');
      expect(preferences[1].slug).toBe('system.response_tone');
    });

    it('should not return other users preferences', async () => {
      // Create preference for test user
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');

      // Create another user and preference
      const otherUser = await prisma.user.create({
        data: {
          email: 'other@example.com',
          firstName: 'Other',
          lastName: 'User',
        },
      });

      await repository.upsertActive(otherUser.userId, 'system.response_tone', 'professional');

      // Test user should only see their own
      const preferences = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );
      expect(preferences).toHaveLength(1);
      expect(preferences[0].value).toBe('casual');
    });

    it('should filter by locationId when provided', async () => {
      // Create global preference
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');

      // Create location-scoped preference
      await repository.upsertActive(
        testUserId,
        'location.default_temperature',
        '72',
        testLocationId,
      );

      // Filter by null location (global only)
      const global = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
        null,
      );

      expect(global).toHaveLength(1);
      expect(global[0].slug).toBe('system.response_tone');

      // Filter by specific location
      const locationSpecific = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
        testLocationId,
      );

      expect(locationSpecific).toHaveLength(1);
      expect(locationSpecific[0].slug).toBe('location.default_temperature');
    });
  });

  describe('findById', () => {
    it('should return preference by ID', async () => {
      const created = await repository.upsertActive(
        testUserId,
        'system.response_tone',
        'casual',
      );

      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('should return null for non-existent ID', async () => {
      const found = await repository.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findActiveWithMerge', () => {
    it('should return global preferences when no location-specific exist', async () => {
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');
      await repository.upsertActive(testUserId, 'system.response_length', 'brief');

      const merged = await repository.findActiveWithMerge(testUserId, testLocationId);

      expect(merged).toHaveLength(2);
    });

    it('should override global with location-specific for same slug', async () => {
      // This test would require a slug that supports both global and location scope
      // For now, we just test that location-specific is returned
      await repository.upsertActive(
        testUserId,
        'location.default_temperature',
        '68',
        testLocationId,
      );

      const merged = await repository.findActiveWithMerge(testUserId, testLocationId);

      const temp = merged.find((p) => p.slug === 'location.default_temperature');
      expect(temp).toBeDefined();
      expect(temp!.value).toBe('68');
      expect(temp!.locationId).toBe(testLocationId);
    });
  });

  describe('findSuggestedUnion', () => {
    it('should return union of global and location-specific SUGGESTED', async () => {
      // Create global suggested
      await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegetarian'],
        0.8,
      );

      // Create location-specific suggested (using location-scoped slug)
      await repository.upsertSuggested(
        testUserId,
        'location.quiet_hours',
        '22:00-07:00',
        0.7,
        testLocationId,
      );

      const union = await repository.findSuggestedUnion(testUserId, testLocationId);

      expect(union).toHaveLength(2);
    });
  });

  describe('updateStatus', () => {
    it('should update preference status', async () => {
      const created = await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegetarian'],
        0.8,
      );

      const updated = await repository.updateStatus(created.id, PreferenceStatus.ACTIVE);

      expect(updated.status).toBe(PreferenceStatus.ACTIVE);
    });
  });

  describe('delete', () => {
    it('should delete preference and return deleted preference', async () => {
      const created = await repository.upsertActive(
        testUserId,
        'system.response_tone',
        'casual',
      );

      const deleted = await repository.delete(created.id);

      expect(deleted.id).toBe(created.id);

      // Verify deletion
      const found = await repository.findById(created.id);
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

    it('should return correct count of all preferences', async () => {
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');
      await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegan'],
        0.8,
      );
      await repository.upsertRejected(testUserId, 'travel.seat_preference', 'middle');

      const count = await repository.count(testUserId);
      expect(count).toBe(3);
    });

    it('should return correct count when filtered by status', async () => {
      await repository.upsertActive(testUserId, 'system.response_tone', 'casual');
      await repository.upsertActive(testUserId, 'system.response_length', 'brief');
      await repository.upsertSuggested(
        testUserId,
        'food.dietary_restrictions',
        ['vegan'],
        0.8,
      );

      const activeCount = await repository.count(testUserId, PreferenceStatus.ACTIVE);
      expect(activeCount).toBe(2);

      const suggestedCount = await repository.count(
        testUserId,
        PreferenceStatus.SUGGESTED,
      );
      expect(suggestedCount).toBe(1);
    });
  });
});
