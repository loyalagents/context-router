import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';

describe('PreferenceCatalog GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
  });

  beforeEach(async () => {
    testUser = await createTestUser();
    setTestUser(testUser);
  });

  afterAll(async () => {
    await app.close();
  });

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables });

  const CATALOG_QUERY = `
    query PreferenceCatalog($category: String) {
      preferenceCatalog(category: $category) {
        id
        slug
        namespace
        displayName
        ownerUserId
        description
        valueType
        scope
        options
        isSensitive
        isCore
        category
      }
    }
  `;

  const CREATE_DEFINITION_MUTATION = `
    mutation CreatePreferenceDefinition($input: CreatePreferenceDefinitionInput!) {
      createPreferenceDefinition(input: $input) {
        id
        slug
        namespace
        ownerUserId
      }
    }
  `;

  const ARCHIVE_MUTATION = `
    mutation ArchivePreferenceDefinition($id: ID!) {
      archivePreferenceDefinition(id: $id) {
        id
        archivedAt
      }
    }
  `;

  describe('preferenceCatalog query', () => {
    it('should return core preference definitions including profile memory slugs', async () => {
      const response = await graphqlRequest(CATALOG_QUERY).expect(200);

      expect(response.body.errors).toBeUndefined();
      const catalog = response.body.data.preferenceCatalog;
      expect(catalog).toBeInstanceOf(Array);
      expect(catalog.length).toBeGreaterThanOrEqual(19);

      // Every entry should have all required fields
      catalog.forEach((def: Record<string, unknown>) => {
        expect(def.id).toBeDefined();
        expect(def.slug).toBeDefined();
        expect(def.namespace).toBeDefined();
        expect(def).toHaveProperty('displayName');
        expect(def.description).toBeDefined();
        expect(def.valueType).toBeDefined();
        expect(def.scope).toBeDefined();
        expect(typeof def.isSensitive).toBe('boolean');
        expect(typeof def.isCore).toBe('boolean');
        expect(def.category).toBeDefined();
      });

      const slugs = catalog.map((d: { slug: string }) => d.slug);
      const coreSlugs = [
        'profile.full_name',
        'profile.first_name',
        'profile.last_name',
        'profile.email',
        'profile.badge_name',
        'profile.company',
        'profile.title',
        'system.response_tone',
        'system.response_length',
        'food.dietary_restrictions',
        'food.cuisine_preferences',
        'food.spice_tolerance',
        'dev.tech_stack',
        'dev.coding_style',
        'travel.seat_preference',
        'travel.meal_preference',
        'communication.preferred_channels',
        'location.default_temperature',
        'location.quiet_hours',
      ];
      for (const slug of coreSlugs) {
        expect(slugs).toContain(slug);
      }

      const profileEmail = catalog.find(
        (d: { slug: string }) => d.slug === 'profile.email',
      );
      expect(profileEmail).toMatchObject({
        displayName: 'Contact Email',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isCore: true,
        isSensitive: true,
        category: 'profile',
      });

      const fullName = catalog.find(
        (d: { slug: string }) => d.slug === 'profile.full_name',
      );
      expect(fullName).toMatchObject({
        displayName: 'Full Name',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isCore: true,
        isSensitive: false,
        category: 'profile',
      });
    });

    it('should filter by category', async () => {
      const response = await graphqlRequest(CATALOG_QUERY, {
        category: 'food',
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const catalog = response.body.data.preferenceCatalog;
      expect(catalog).toHaveLength(3);

      const slugs = catalog.map((d: { slug: string }) => d.slug).sort();
      expect(slugs).toEqual([
        'food.cuisine_preferences',
        'food.dietary_restrictions',
        'food.spice_tolerance',
      ]);

      catalog.forEach((def: { category: string }) => {
        expect(def.category).toBe('food');
      });
    });

    it('should return empty array for unknown category', async () => {
      const response = await graphqlRequest(CATALOG_QUERY, {
        category: 'nonexistent',
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.preferenceCatalog).toEqual([]);
    });

    it('should include options for enum-type preferences', async () => {
      const response = await graphqlRequest(CATALOG_QUERY).expect(200);

      const catalog = response.body.data.preferenceCatalog;
      const spiceTolerance = catalog.find(
        (d: { slug: string }) => d.slug === 'food.spice_tolerance',
      );

      expect(spiceTolerance.valueType).toBe('ENUM');
      expect(spiceTolerance.options).toEqual([
        'none',
        'mild',
        'medium',
        'hot',
        'extra_hot',
      ]);

      // Non-enum types should have null options
      const dietaryRestrictions = catalog.find(
        (d: { slug: string }) => d.slug === 'food.dietary_restrictions',
      );
      expect(dietaryRestrictions.valueType).toBe('ARRAY');
      expect(dietaryRestrictions.options).toBeNull();
    });

    it('should include location-scoped preferences', async () => {
      const response = await graphqlRequest(CATALOG_QUERY).expect(200);

      const catalog = response.body.data.preferenceCatalog;
      const defaultTemp = catalog.find(
        (d: { slug: string }) => d.slug === 'location.default_temperature',
      );

      expect(defaultTemp.scope).toBe('LOCATION');
      expect(defaultTemp.category).toBe('location');

      // Most others should be GLOBAL
      const responseTone = catalog.find(
        (d: { slug: string }) => d.slug === 'system.response_tone',
      );
      expect(responseTone.scope).toBe('GLOBAL');
    });

    it('should return GLOBAL namespace for seeded core definitions', async () => {
      const response = await graphqlRequest(CATALOG_QUERY).expect(200);
      const catalog = response.body.data.preferenceCatalog;
      const globalDefs = catalog.filter((d: { ownerUserId: string | null }) => d.ownerUserId === null);
      expect(globalDefs.length).toBeGreaterThanOrEqual(19);
      globalDefs.forEach((def: { namespace: string }) => {
        expect(def.namespace).toBe('GLOBAL');
      });
    });
  });

  describe('namespace-aware catalog', () => {
    it('authenticated user should see their own definition in catalog', async () => {
      // Create a user-owned definition
      const createRes = await graphqlRequest(CREATE_DEFINITION_MUTATION, {
        input: {
          slug: 'custom.user_catalog_pref',
          description: 'User-owned catalog pref',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);
      expect(createRes.body.errors).toBeUndefined();

      // Query the catalog — should include user def
      const catalogRes = await graphqlRequest(CATALOG_QUERY, { category: 'custom' }).expect(200);
      const slugs = catalogRes.body.data.preferenceCatalog.map((d: { slug: string }) => d.slug);
      expect(slugs).toContain('custom.user_catalog_pref');
    });

    it('archived definition should not appear in catalog', async () => {
      const createRes = await graphqlRequest(CREATE_DEFINITION_MUTATION, {
        input: {
          slug: 'custom.to_archive',
          description: 'Will be archived',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);
      const defId = createRes.body.data.createPreferenceDefinition.id;

      await graphqlRequest(ARCHIVE_MUTATION, { id: defId }).expect(200);

      const catalogRes = await graphqlRequest(CATALOG_QUERY, { category: 'custom' }).expect(200);
      const slugs = catalogRes.body.data.preferenceCatalog.map((d: { slug: string }) => d.slug);
      expect(slugs).not.toContain('custom.to_archive');
    });

    it('unauthenticated query should NOT return user-owned definitions (tripwire)', async () => {
      // Create a user-owned definition while authenticated
      const createRes = await graphqlRequest(CREATE_DEFINITION_MUTATION, {
        input: {
          slug: 'custom.private_pref',
          description: 'Should not leak to unauth',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);
      expect(createRes.body.errors).toBeUndefined();

      // Simulate unauthenticated request (no user in context)
      setTestUser(null as unknown as TestUser);

      const unauthRes = await graphqlRequest(CATALOG_QUERY, { category: 'custom' }).expect(200);
      const slugs = unauthRes.body.data.preferenceCatalog.map((d: { slug: string }) => d.slug);
      expect(slugs).not.toContain('custom.private_pref');
    });
  });
});
