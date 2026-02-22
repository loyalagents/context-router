/**
 * PreferenceDefinitionRepository Integration Tests
 *
 * Tests the in-memory cache repository against a real test database.
 * Database is reset and re-seeded between tests via the global beforeEach hook.
 */
import { PreferenceDefinitionRepository } from '../../src/modules/preferences/preference-definition/preference-definition.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { getPrismaClient } from '../setup/test-db';

describe('PreferenceDefinitionRepository (integration)', () => {
  let repository: PreferenceDefinitionRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    repository = new PreferenceDefinitionRepository(prisma);
  });

  beforeEach(async () => {
    // Refresh cache after global beforeEach seeds definitions
    await repository.refreshCache();
  });

  describe('refreshCache', () => {
    it('should load all 12 definitions into cache', () => {
      const allSlugs = repository.getAllSlugs();
      expect(allSlugs).toHaveLength(12);
    });
  });

  describe('isKnownSlug', () => {
    it('should return true for a known slug', () => {
      expect(repository.isKnownSlug('food.dietary_restrictions')).toBe(true);
    });

    it('should return false for an unknown slug', () => {
      expect(repository.isKnownSlug('unknown.slug')).toBe(false);
    });
  });

  describe('getDefinition', () => {
    it('should return correct fields for a known slug', () => {
      const def = repository.getDefinition('system.response_tone');

      expect(def).toBeDefined();
      expect(def!.slug).toBe('system.response_tone');
      expect(def!.description).toBeDefined();
      expect(def!.valueType).toBe('ENUM');
      expect(def!.scope).toBe('GLOBAL');
      expect(def!.options).toEqual([
        'casual',
        'professional',
        'concise',
        'enthusiastic',
      ]);
      expect(def!.isCore).toBe(true);
      expect(def!.category).toBe('system');
    });

    it('should return undefined for an unknown slug', () => {
      expect(repository.getDefinition('unknown.slug')).toBeUndefined();
    });
  });

  describe('getAllSlugs', () => {
    it('should return all 12 slugs', () => {
      const slugs = repository.getAllSlugs();
      expect(slugs).toHaveLength(12);
      expect(slugs).toContain('food.dietary_restrictions');
      expect(slugs).toContain('system.response_tone');
      expect(slugs).toContain('location.quiet_hours');
    });
  });

  describe('getSlugsByCategory', () => {
    it('should return food slugs', () => {
      const foodSlugs = repository.getSlugsByCategory('food');
      expect(foodSlugs).toHaveLength(3);
      expect(foodSlugs).toContain('food.dietary_restrictions');
      expect(foodSlugs).toContain('food.cuisine_preferences');
      expect(foodSlugs).toContain('food.spice_tolerance');
    });

    it('should return empty array for unknown category', () => {
      expect(repository.getSlugsByCategory('nonexistent')).toEqual([]);
    });
  });

  describe('getAllCategories', () => {
    it('should return 6 sorted categories', () => {
      const categories = repository.getAllCategories();
      expect(categories).toHaveLength(6);
      expect(categories).toEqual([
        'communication',
        'dev',
        'food',
        'location',
        'system',
        'travel',
      ]);
    });
  });

  describe('findSimilarSlugs', () => {
    it('should return food-related slugs for "food" input', () => {
      const similar = repository.findSimilarSlugs('food');
      expect(similar.length).toBeGreaterThan(0);
      expect(similar.every((s) => s.startsWith('food.'))).toBe(true);
    });

    it('should respect limit parameter', () => {
      const similar = repository.findSimilarSlugs('food', 1);
      expect(similar).toHaveLength(1);
    });

    it('should return empty array for completely unrelated input', () => {
      const similar = repository.findSimilarSlugs('zzzznothing');
      expect(similar).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('should return all definitions with category derived from slug', () => {
      const all = repository.getAll();
      expect(all).toHaveLength(12);

      for (const def of all) {
        expect(def.category).toBe(def.slug.split('.')[0]);
        expect(def.isCore).toBe(true);
      }
    });
  });
});
