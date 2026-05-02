/**
 * PreferenceDefinitionRepository Integration Tests (namespace-aware)
 *
 * Tests the repository against a real test database.
 * Global beforeEach (jest.after-env.ts) resets DB and seeds GLOBAL definitions.
 */
import { PreferenceDefinitionRepository } from '../../src/modules/preferences/preference-definition/preference-definition.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { getPrismaClient } from '../setup/test-db';

describe('PreferenceDefinitionRepository (integration)', () => {
  let repository: PreferenceDefinitionRepository;
  let prisma: PrismaService;
  let testUserId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    repository = new PreferenceDefinitionRepository(prisma);
  });

  beforeEach(async () => {
    // Create a test user for user-owned definition tests
    const user = await prisma.user.create({
      data: {
        email: 'deftest@example.com',
      },
    });
    testUserId = user.userId;
  });

  // ──────────────────────────────────────────────
  // getAll
  // ──────────────────────────────────────────────
  describe('getAll', () => {
    it('should return all seeded GLOBAL definitions when no userId given', async () => {
      const defs = await repository.getAll();
      expect(defs).toHaveLength(19);
      expect(defs.every((d) => d.namespace === 'GLOBAL')).toBe(true);
    });

    it('should return GLOBAL + user defs when userId given', async () => {
      await repository.create({
        slug: 'custom.user_pref',
        description: 'User-owned definition',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      const defs = await repository.getAll(testUserId);
      expect(defs.length).toBe(20); // 19 GLOBAL + 1 user

      const userDef = defs.find((d) => d.slug === 'custom.user_pref');
      expect(userDef).toBeDefined();
      expect(userDef!.namespace).toBe(`USER:${testUserId}`);
    });

    it('should exclude archived definitions', async () => {
      const def = await repository.create({
        slug: 'custom.to_archive',
        description: 'Will be archived',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      await repository.archive(def.id);

      const defs = await repository.getAll(testUserId);
      const archivedDef = defs.find((d) => d.slug === 'custom.to_archive');
      expect(archivedDef).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────
  // getDefinitionBySlug
  // ──────────────────────────────────────────────
  describe('getDefinitionBySlug', () => {
    it('should find GLOBAL definition by slug', async () => {
      const def = await repository.getDefinitionBySlug('system.response_tone');
      expect(def).toBeDefined();
      expect(def!.slug).toBe('system.response_tone');
      expect(def!.namespace).toBe('GLOBAL');
    });

    it('should return null for unknown slug', async () => {
      const def = await repository.getDefinitionBySlug('unknown.slug');
      expect(def).toBeNull();
    });

    it('should prefer user-owned definition over GLOBAL when userId provided', async () => {
      await repository.create({
        slug: 'system.response_tone',
        description: 'My custom response tone',
        valueType: 'ENUM',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      const def = await repository.getDefinitionBySlug(
        'system.response_tone',
        testUserId,
      );
      expect(def).toBeDefined();
      expect(def!.namespace).toBe(`USER:${testUserId}`);
      expect(def!.description).toBe('My custom response tone');
    });

    it('should fall back to GLOBAL if user has no matching def', async () => {
      const def = await repository.getDefinitionBySlug(
        'food.dietary_restrictions',
        testUserId,
      );
      expect(def).toBeDefined();
      expect(def!.namespace).toBe('GLOBAL');
    });

    it('should exclude archived definitions', async () => {
      const def = await repository.create({
        slug: 'custom.archived',
        description: 'Will be archived',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });
      await repository.archive(def.id);

      const found = await repository.getDefinitionBySlug(
        'custom.archived',
        testUserId,
      );
      expect(found).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // getDefinitionById
  // ──────────────────────────────────────────────
  describe('getDefinitionById', () => {
    it('should find definition by id', async () => {
      const all = await repository.getAll();
      const first = all[0];

      const found = await repository.getDefinitionById(first.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(first.id);
    });

    it('should return archived definitions', async () => {
      const def = await repository.create({
        slug: 'custom.find_archived',
        description: 'Will be archived',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });
      await repository.archive(def.id);

      const found = await repository.getDefinitionById(def.id);
      expect(found).toBeDefined();
      expect(found!.archivedAt).not.toBeNull();
    });

    it('should return null for non-existent id', async () => {
      const found = await repository.getDefinitionById('non-existent-uuid');
      expect(found).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // resolveSlugToDefinitionId
  // ──────────────────────────────────────────────
  describe('resolveSlugToDefinitionId', () => {
    it('should resolve GLOBAL slug to its id', async () => {
      const expected = await repository.getDefinitionBySlug(
        'system.response_tone',
      );
      const id = await repository.resolveSlugToDefinitionId(
        'system.response_tone',
      );
      expect(id).toBe(expected!.id);
    });

    it('should return null for unknown slug', async () => {
      const id = await repository.resolveSlugToDefinitionId('unknown.slug');
      expect(id).toBeNull();
    });

    it('should prefer user-owned def id over global when userId provided', async () => {
      const userDef = await repository.create({
        slug: 'system.response_tone',
        description: 'User version',
        valueType: 'ENUM',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      const id = await repository.resolveSlugToDefinitionId(
        'system.response_tone',
        testUserId,
      );
      expect(id).toBe(userDef.id);
    });

    it('should fall back to global id when user has no matching def', async () => {
      const globalDef = await repository.getDefinitionBySlug(
        'food.dietary_restrictions',
      );
      const id = await repository.resolveSlugToDefinitionId(
        'food.dietary_restrictions',
        testUserId,
      );
      expect(id).toBe(globalDef!.id);
    });
  });

  // ──────────────────────────────────────────────
  // create
  // ──────────────────────────────────────────────
  describe('create', () => {
    it('should create a GLOBAL definition (ownerUserId=null)', async () => {
      const created = await repository.create({
        slug: 'test.new_definition',
        description: 'A new test definition',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: null,
      });

      expect(created.id).toBeDefined();
      expect(created.slug).toBe('test.new_definition');
      expect(created.namespace).toBe('GLOBAL');
      expect(created.ownerUserId).toBeNull();
      expect(created.isCore).toBe(false);
      expect(created.archivedAt).toBeNull();
    });

    it('should create a USER-owned definition (ownerUserId provided)', async () => {
      const created = await repository.create({
        slug: 'custom.user_def',
        description: 'User-owned definition',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      expect(created.namespace).toBe(`USER:${testUserId}`);
      expect(created.ownerUserId).toBe(testUserId);
      expect(created.isCore).toBe(false);
    });

    it('should store and return displayName when provided', async () => {
      const created = await repository.create({
        slug: 'custom.with_display_name',
        description: 'Has a display name',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
        displayName: 'My Display Label',
      });

      expect(created.displayName).toBe('My Display Label');
    });

    it('should store null displayName when not provided', async () => {
      const created = await repository.create({
        slug: 'custom.no_display_name',
        description: 'No display name',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      expect(created.displayName).toBeNull();
    });

    it('should allow USER def with same slug as GLOBAL (different namespace)', async () => {
      const globalDef = await repository.getDefinitionBySlug(
        'system.response_tone',
      );
      expect(globalDef).toBeDefined();

      const userDef = await repository.create({
        slug: 'system.response_tone',
        description: 'My version',
        valueType: 'ENUM',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      expect(userDef.namespace).toBe(`USER:${testUserId}`);
    });

    it('should throw on duplicate (namespace, slug) within same user', async () => {
      await repository.create({
        slug: 'custom.duplicate',
        description: 'First',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      await expect(
        repository.create({
          slug: 'custom.duplicate',
          description: 'Second',
          valueType: 'STRING',
          scope: 'GLOBAL',
          ownerUserId: testUserId,
        }),
      ).rejects.toThrow();
    });

    it('should throw on duplicate GLOBAL slug', async () => {
      await expect(
        repository.create({
          slug: 'food.dietary_restrictions',
          description: 'Duplicate GLOBAL slug',
          valueType: 'ARRAY',
          scope: 'GLOBAL',
          ownerUserId: null,
        }),
      ).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────
  // update
  // ──────────────────────────────────────────────
  describe('update', () => {
    it('should update description by id', async () => {
      const def = await repository.getDefinitionBySlug(
        'food.dietary_restrictions',
      );
      const updated = await repository.update(def!.id, {
        description: 'Updated description',
      });

      expect(updated.description).toBe('Updated description');
      expect(updated.slug).toBe('food.dietary_restrictions');
    });

    it('should update only provided fields', async () => {
      const def = await repository.getDefinitionBySlug('system.response_tone');
      const before = def!;

      const updated = await repository.update(before.id, {
        description: 'Changed description',
      });

      expect(updated.description).toBe('Changed description');
      expect(updated.valueType).toBe(before.valueType);
      expect(updated.scope).toBe(before.scope);
    });

    it('should update displayName by id', async () => {
      const def = await repository.create({
        slug: 'custom.display_name_update',
        description: 'Has a display name',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
        displayName: 'Original Label',
      });

      const updated = await repository.update(def.id, {
        displayName: 'Updated Label',
      });

      expect(updated.displayName).toBe('Updated Label');
      expect(updated.description).toBe('Has a display name'); // unchanged
    });

    it('should throw for non-existent id', async () => {
      await expect(
        repository.update('non-existent-uuid', { description: 'Will fail' }),
      ).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────
  // archive
  // ──────────────────────────────────────────────
  describe('archive', () => {
    it('should set archivedAt on the definition', async () => {
      const def = await repository.create({
        slug: 'custom.to_archive',
        description: 'Will be archived',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      const archived = await repository.archive(def.id);

      expect(archived.archivedAt).not.toBeNull();
      expect(archived.archivedAt).toBeInstanceOf(Date);
    });

    it('should allow recreating same slug after archiving (partial unique index)', async () => {
      const def = await repository.create({
        slug: 'custom.recyclable',
        description: 'Will be archived then recreated',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      await repository.archive(def.id);

      const recreated = await repository.create({
        slug: 'custom.recyclable',
        description: 'Recreated',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      expect(recreated.id).not.toBe(def.id);
      expect(recreated.archivedAt).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // isKnownSlug
  // ──────────────────────────────────────────────
  describe('isKnownSlug', () => {
    it('should return true for a known GLOBAL slug', async () => {
      const known = await repository.isKnownSlug('food.dietary_restrictions');
      expect(known).toBe(true);
    });

    it('should return false for an unknown slug', async () => {
      const known = await repository.isKnownSlug('unknown.slug');
      expect(known).toBe(false);
    });

    it('should return true for user-owned slug when userId provided', async () => {
      await repository.create({
        slug: 'custom.user_slug',
        description: 'User slug',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: testUserId,
      });

      const known = await repository.isKnownSlug(
        'custom.user_slug',
        testUserId,
      );
      expect(known).toBe(true);
    });
  });

  // ──────────────────────────────────────────────
  // getAllCategories / getSlugsByCategory
  // ──────────────────────────────────────────────
  describe('getAllCategories', () => {
    it('should return sorted categories for GLOBAL defs', async () => {
      const categories = await repository.getAllCategories();
      expect(categories).toEqual([
        'communication',
        'dev',
        'food',
        'location',
        'profile',
        'system',
        'travel',
      ]);
    });
  });

  describe('getSlugsByCategory', () => {
    it('should return food slugs', async () => {
      const slugs = await repository.getSlugsByCategory('food');
      expect(slugs).toHaveLength(3);
      expect(slugs).toContain('food.dietary_restrictions');
    });

    it('should return empty array for unknown category', async () => {
      const slugs = await repository.getSlugsByCategory('nonexistent');
      expect(slugs).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────
  // findSimilarSlugs
  // ──────────────────────────────────────────────
  describe('findSimilarSlugs', () => {
    it('should return food-related slugs for "food" input', async () => {
      const similar = await repository.findSimilarSlugs('food');
      expect(similar.length).toBeGreaterThan(0);
      expect(similar.every((s) => s.startsWith('food.'))).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const similar = await repository.findSimilarSlugs('food', 1);
      expect(similar).toHaveLength(1);
    });

    it('should return empty array for completely unrelated input', async () => {
      const similar = await repository.findSimilarSlugs('zzzznothing');
      expect(similar).toEqual([]);
    });
  });
});
