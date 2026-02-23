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
        slug
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

  describe('preferenceCatalog query', () => {
    it('should return all 12 preference definitions', async () => {
      const response = await graphqlRequest(CATALOG_QUERY).expect(200);

      expect(response.body.errors).toBeUndefined();
      const catalog = response.body.data.preferenceCatalog;
      expect(catalog).toBeInstanceOf(Array);
      expect(catalog).toHaveLength(12);

      // Every entry should have all required fields
      catalog.forEach((def: Record<string, unknown>) => {
        expect(def.slug).toBeDefined();
        expect(def.description).toBeDefined();
        expect(def.valueType).toBeDefined();
        expect(def.scope).toBeDefined();
        expect(typeof def.isSensitive).toBe('boolean');
        expect(typeof def.isCore).toBe('boolean');
        expect(def.category).toBeDefined();
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
  });
});
