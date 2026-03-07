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
        id
        slug
        namespace
        ownerUserId
        displayName
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
    mutation UpdatePreferenceDefinition($id: ID!, $input: UpdatePreferenceDefinitionInput!) {
      updatePreferenceDefinition(id: $id, input: $input) {
        id
        slug
        namespace
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

  const ARCHIVE_MUTATION = `
    mutation ArchivePreferenceDefinition($id: ID!) {
      archivePreferenceDefinition(id: $id) {
        id
        slug
        archivedAt
      }
    }
  `;

  const CATALOG_QUERY = `
    query PreferenceCatalog($category: String) {
      preferenceCatalog(category: $category) {
        id
        slug
        namespace
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
      expect(created.id).toBeDefined();
      expect(created.slug).toBe('test.new_preference');
      expect(created.namespace).toBe(`USER:${testUser.userId}`);
      expect(created.ownerUserId).toBe(testUser.userId);
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
    it('should update description of a user-owned definition successfully', async () => {
      // Create a user definition first
      const createRes = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'test.update_target',
          description: 'Original description',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);
      const defId = createRes.body.data.createPreferenceDefinition.id;

      const response = await graphqlRequest(UPDATE_MUTATION, {
        id: defId,
        input: {
          description: 'Updated description',
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      const updated = response.body.data.updatePreferenceDefinition;
      expect(updated.id).toBe(defId);
      expect(updated.slug).toBe('test.update_target');
      expect(updated.description).toBe('Updated description');
      expect(updated.valueType).toBe('STRING');
    });

    it('should update options on a user-owned definition', async () => {
      const createRes = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'test.options_update',
          description: 'Options test',
          valueType: 'ENUM',
          scope: 'GLOBAL',
          options: ['a', 'b'],
        },
      }).expect(200);
      const defId = createRes.body.data.createPreferenceDefinition.id;

      const response = await graphqlRequest(UPDATE_MUTATION, {
        id: defId,
        input: {
          options: ['a', 'b', 'c'],
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.updatePreferenceDefinition.options).toEqual(['a', 'b', 'c']);
    });

    it('should update isSensitive on a user-owned definition', async () => {
      const createRes = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'test.sensitive_update',
          description: 'Sensitive test',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);
      const defId = createRes.body.data.createPreferenceDefinition.id;

      const response = await graphqlRequest(UPDATE_MUTATION, {
        id: defId,
        input: { isSensitive: true },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.updatePreferenceDefinition.isSensitive).toBe(true);
    });

    it('should return error for unknown id', async () => {
      const response = await graphqlRequest(UPDATE_MUTATION, {
        id: '00000000-0000-0000-0000-000000000000',
        input: { description: 'Will fail' },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
    });
  });

  describe('user definition namespace', () => {
    it('should create definition in user namespace and appear in catalog', async () => {
      const createRes = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'custom.user_pref',
          description: 'User-owned preference',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

      expect(createRes.body.errors).toBeUndefined();
      const created = createRes.body.data.createPreferenceDefinition;
      expect(created.namespace).toBe(`USER:${testUser.userId}`);
      expect(created.ownerUserId).toBe(testUser.userId);

      // Should appear in authenticated catalog
      const catalogRes = await graphqlRequest(CATALOG_QUERY, { category: 'custom' }).expect(200);
      const catalog = catalogRes.body.data.preferenceCatalog;
      expect(catalog.some((d: { slug: string }) => d.slug === 'custom.user_pref')).toBe(true);
    });

    it('should reject user definition with same slug as active global definition', async () => {
      // 'food.dietary_restrictions' is a GLOBAL seeded definition
      const response = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'food.dietary_restrictions',
          description: 'Collision with global',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
    });
  });

  describe('archivePreferenceDefinition', () => {
    it('should archive a user-owned definition', async () => {
      const createRes = await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'test.to_archive',
          description: 'Will be archived',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);
      const defId = createRes.body.data.createPreferenceDefinition.id;

      const archiveRes = await graphqlRequest(ARCHIVE_MUTATION, { id: defId }).expect(200);
      expect(archiveRes.body.errors).toBeUndefined();
      expect(archiveRes.body.data.archivePreferenceDefinition.archivedAt).toBeTruthy();

      // Archived def should not appear in catalog
      const catalogRes = await graphqlRequest(CATALOG_QUERY, { category: 'test' }).expect(200);
      const slugs = catalogRes.body.data.preferenceCatalog.map((d: { slug: string }) => d.slug);
      expect(slugs).not.toContain('test.to_archive');
    });

    it('should allow recreating a slug after archiving (double archive/recreate cycle)', async () => {
      const input = {
        slug: 'test.recycle_slug',
        description: 'Recycle test',
        valueType: 'STRING',
        scope: 'GLOBAL',
      };

      // Create → archive → recreate → archive → recreate
      for (let i = 0; i < 2; i++) {
        const createRes = await graphqlRequest(CREATE_MUTATION, { input }).expect(200);
        expect(createRes.body.errors).toBeUndefined();
        const defId = createRes.body.data.createPreferenceDefinition.id;

        const archiveRes = await graphqlRequest(ARCHIVE_MUTATION, { id: defId }).expect(200);
        expect(archiveRes.body.errors).toBeUndefined();
      }

      // Final recreation should succeed
      const finalRes = await graphqlRequest(CREATE_MUTATION, { input }).expect(200);
      expect(finalRes.body.errors).toBeUndefined();
      expect(finalRes.body.data.createPreferenceDefinition.slug).toBe('test.recycle_slug');
    });
  });

  describe('integration: create definition then use it', () => {
    it('should allow setting a preference with a newly created user definition slug', async () => {
      // Create a user-owned definition
      await graphqlRequest(CREATE_MUTATION, {
        input: {
          slug: 'workshop.team_name',
          description: 'Team name for workshop',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      }).expect(200);

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
        input: { slug: 'workshop.team_name', value: 'Team Alpha' },
      }).expect(200);

      expect(prefResponse.body.errors).toBeUndefined();
      const pref = prefResponse.body.data.setPreference;
      expect(pref.slug).toBe('workshop.team_name');
      expect(pref.value).toBe('Team Alpha');
      expect(pref.status).toBe('ACTIVE');
    });
  });
});
