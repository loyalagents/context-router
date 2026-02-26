import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';

describe('PreferenceDefinition Mutations (e2e)', () => {
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

  const CREATE_MUTATION = `
    mutation CreatePreferenceDefinition($input: CreatePreferenceDefinitionInput!) {
      createPreferenceDefinition(input: $input) {
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

  const UPDATE_MUTATION = `
    mutation UpdatePreferenceDefinition($slug: String!, $input: UpdatePreferenceDefinitionInput!) {
      updatePreferenceDefinition(slug: $slug, input: $input) {
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

  describe('createPreferenceDefinition', () => {
    it('should create a new definition successfully', async () => {
      const response = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'test.new_preference',
          description: 'A test preference',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const created = response.body.data.createPreferenceDefinition;
      expect(created.slug).toBe('test.new_preference');
      expect(created.description).toBe('A test preference');
      expect(created.valueType).toBe('STRING');
      expect(created.scope).toBe('GLOBAL');
      expect(created.options).toBeNull();
      expect(created.isSensitive).toBe(false);
      expect(created.isCore).toBe(false);
      expect(created.category).toBe('test');
    });

    it('should create an ENUM definition with options', async () => {
      const response = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'test.color_preference',
          description: 'Preferred color',
          valueType: 'ENUM',
          scope: 'GLOBAL',
          options: ['red', 'green', 'blue'],
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const created = response.body.data.createPreferenceDefinition;
      expect(created.valueType).toBe('ENUM');
      expect(created.options).toEqual(['red', 'green', 'blue']);
    });

    it('should return error for duplicate slug', async () => {
      // 'food.dietary_restrictions' is seeded by default
      const response = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'food.dietary_restrictions',
          description: 'Duplicate slug',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
    });

    it('should return error for invalid slug format (uppercase)', async () => {
      const response = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'Test.InvalidSlug',
          description: 'Bad slug',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
    });

    it('should return error for invalid slug format (no dot)', async () => {
      const response = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'nodot',
          description: 'Bad slug',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
    });

    it('should set isSensitive and isCore when provided', async () => {
      const response = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'test.sensitive_pref',
          description: 'Sensitive data',
          valueType: 'STRING',
          scope: 'GLOBAL',
          isSensitive: true,
          isCore: true,
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const created = response.body.data.createPreferenceDefinition;
      expect(created.isSensitive).toBe(true);
      expect(created.isCore).toBe(true);
    });
  });

  describe('updatePreferenceDefinition', () => {
    it('should update description successfully', async () => {
      const response = await graphqlRequest(UPDATE_MUTATION, {
        slug: 'food.dietary_restrictions',
        input: {
          description: 'Updated description',
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const updated = response.body.data.updatePreferenceDefinition;
      expect(updated.slug).toBe('food.dietary_restrictions');
      expect(updated.description).toBe('Updated description');
      // Other fields should remain unchanged
      expect(updated.valueType).toBe('ARRAY');
      expect(updated.scope).toBe('GLOBAL');
    });

    it('should update valueType and options', async () => {
      const response = await graphqlRequest(UPDATE_MUTATION, {
        slug: 'food.spice_tolerance',
        input: {
          options: ['none', 'mild', 'medium', 'hot', 'extra_hot', 'extreme'],
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const updated = response.body.data.updatePreferenceDefinition;
      expect(updated.options).toEqual([
        'none',
        'mild',
        'medium',
        'hot',
        'extra_hot',
        'extreme',
      ]);
    });

    it('should update scope, isSensitive, and isCore', async () => {
      const response = await graphqlRequest(UPDATE_MUTATION, {
        slug: 'food.dietary_restrictions',
        input: {
          isSensitive: true,
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const updated = response.body.data.updatePreferenceDefinition;
      expect(updated.isSensitive).toBe(true);
    });

    it('should return error for unknown slug', async () => {
      const response = await graphqlRequest(UPDATE_MUTATION, {
        slug: 'nonexistent.slug',
        input: {
          description: 'Will fail',
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
    });

    it('should leave other fields unchanged on partial update', async () => {
      // First, get the current state
      const catalogResponse = await graphqlRequest(CATALOG_QUERY).expect(200);
      const original = catalogResponse.body.data.preferenceCatalog.find(
        (d: { slug: string }) => d.slug === 'system.response_tone',
      );

      // Update only description
      const response = await graphqlRequest(UPDATE_MUTATION, {
        slug: 'system.response_tone',
        input: {
          description: 'Changed description only',
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const updated = response.body.data.updatePreferenceDefinition;
      expect(updated.description).toBe('Changed description only');
      expect(updated.valueType).toBe(original.valueType);
      expect(updated.scope).toBe(original.scope);
      expect(updated.options).toEqual(original.options);
      expect(updated.isSensitive).toBe(original.isSensitive);
      expect(updated.isCore).toBe(original.isCore);
    });
  });

  describe('cache consistency', () => {
    it('should make newly created definition available in preferenceCatalog query', async () => {
      // Create a new definition
      await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'custom.new_field',
          description: 'New custom field',
          valueType: 'BOOLEAN',
          scope: 'GLOBAL',
        },
      }).expect(200);

      // Query the catalog and verify it includes the new definition
      const catalogResponse = await graphqlRequest(CATALOG_QUERY, {
        category: 'custom',
      }).expect(200);

      expect(catalogResponse.body.errors).toBeUndefined();
      const catalog = catalogResponse.body.data.preferenceCatalog;
      expect(catalog).toHaveLength(1);
      expect(catalog[0].slug).toBe('custom.new_field');
      expect(catalog[0].description).toBe('New custom field');
    });

    it('should reflect updates in preferenceCatalog query', async () => {
      // Update an existing definition
      await graphqlRequest(UPDATE_MUTATION, {
        slug: 'food.spice_tolerance',
        input: {
          description: 'Updated via test',
        },
      }).expect(200);

      // Query and verify
      const catalogResponse = await graphqlRequest(CATALOG_QUERY, {
        category: 'food',
      }).expect(200);

      const updated = catalogResponse.body.data.preferenceCatalog.find(
        (d: { slug: string }) => d.slug === 'food.spice_tolerance',
      );
      expect(updated.description).toBe('Updated via test');
    });
  });

  describe('integration: create definition then use it', () => {
    it('should allow setting a preference with a newly created definition slug', async () => {
      // Create a new definition
      await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'workshop.team_name',
          description: 'Team name for workshop',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

      // Set a preference using the new slug
      const SET_PREFERENCE = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            slug
            value
            status
          }
        }
      `;

      const prefResponse = await graphqlRequest(SET_PREFERENCE, {
        input: {
          slug: 'workshop.team_name',
          value: 'Team Alpha',
        },
      }).expect(200);

      expect(prefResponse.body.errors).toBeUndefined();
      const pref = prefResponse.body.data.setPreference;
      expect(pref.slug).toBe('workshop.team_name');
      expect(pref.value).toBe('Team Alpha');
      expect(pref.status).toBe('ACTIVE');
    });
  });
});
