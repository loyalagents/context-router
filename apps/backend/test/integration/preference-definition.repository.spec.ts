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
    it('should load all definitions into cache', () => {
      const allSlugs = repository.getAllSlugs();
      expect(allSlugs).toHaveLength(43);
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
    it('should return all slugs', () => {
      const slugs = repository.getAllSlugs();
      expect(slugs).toHaveLength(43);
      expect(slugs).toContain('food.dietary_restrictions');
      expect(slugs).toContain('system.response_tone');
      expect(slugs).toContain('location.quiet_hours');
      expect(slugs).toContain('profile.bio');
      expect(slugs).toContain('professional.skills');
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
    it('should return all sorted categories', () => {
      const categories = repository.getAllCategories();
      expect(categories).toEqual([
        'communication',
        'concerns',
        'food',
        'goals',
        'identity',
        'location',
        'professional',
        'profile',
        'projects',
        'relationships',
        'system',
        'travel',
        'values',
        'work',
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
      expect(all).toHaveLength(43);

      for (const def of all) {
        expect(def.category).toBe(def.slug.split('.')[0]);
        expect(def.isCore).toBe(true);
      }
    });
  });

  describe('create', () => {
    it('should create a new definition and update the cache', async () => {
      const created = await repository.create({
        slug: 'test.new_definition',
        description: 'A new test definition',
        valueType: 'STRING',
        scope: 'GLOBAL',
      });

      expect(created.slug).toBe('test.new_definition');
      expect(created.description).toBe('A new test definition');
      expect(created.valueType).toBe('STRING');
      expect(created.scope).toBe('GLOBAL');
      expect(created.isSensitive).toBe(false);
      expect(created.isCore).toBe(false);

      // Cache should be updated
      expect(repository.isKnownSlug('test.new_definition')).toBe(true);
      const cached = repository.getDefinition('test.new_definition');
      expect(cached).toBeDefined();
      expect(cached!.category).toBe('test');
    });

    it('should create an ENUM definition with options', async () => {
      const created = await repository.create({
        slug: 'test.enum_field',
        description: 'An enum field',
        valueType: 'ENUM',
        scope: 'GLOBAL',
        options: ['a', 'b', 'c'],
      });

      expect(created.options).toEqual(['a', 'b', 'c']);
    });

    it('should throw on duplicate slug', async () => {
      await expect(
        repository.create({
          slug: 'food.dietary_restrictions',
          description: 'Duplicate',
          valueType: 'STRING',
          scope: 'GLOBAL',
        }),
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update a definition and refresh the cache', async () => {
      const updated = await repository.update('food.dietary_restrictions', {
        description: 'Updated description',
      });

      expect(updated.slug).toBe('food.dietary_restrictions');
      expect(updated.description).toBe('Updated description');

      // Cache should reflect the update
      const cached = repository.getDefinition('food.dietary_restrictions');
      expect(cached!.description).toBe('Updated description');
    });

    it('should update only provided fields', async () => {
      const before = repository.getDefinition('system.response_tone')!;

      const updated = await repository.update('system.response_tone', {
        description: 'Changed description',
      });

      expect(updated.description).toBe('Changed description');
      expect(updated.valueType).toBe(before.valueType);
      expect(updated.scope).toBe(before.scope);
      expect(updated.options).toEqual(before.options);
    });

    it('should throw for non-existent slug', async () => {
      await expect(
        repository.update('nonexistent.slug', {
          description: 'Will fail',
        }),
      ).rejects.toThrow();
    });
  });
});
