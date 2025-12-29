import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';

describe('Preferences GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
  });

  beforeEach(async () => {
    // Create fresh user after resetDb()
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

  describe('createPreference mutation', () => {
    it('should create a global preference', async () => {
      const mutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
            userId
            category
            key
            value
            locationId
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        data: {
          category: 'dietary',
          key: 'allergies',
          value: ['peanuts', 'shellfish'],
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.createPreference).toMatchObject({
        userId: testUser.userId,
        category: 'dietary',
        key: 'allergies',
        value: ['peanuts', 'shellfish'],
        locationId: null,
      });
      expect(response.body.data.createPreference.preferenceId).toBeDefined();
    });

    it('should create a location-scoped preference', async () => {
      // First create a location
      const createLocationMutation = `
        mutation CreateLocation($data: CreateLocationInput!) {
          createLocation(data: $data) {
            locationId
            label
          }
        }
      `;

      const locationResponse = await graphqlRequest(createLocationMutation, {
        data: {
          type: 'OTHER',
          label: 'Test Restaurant',
          address: '123 Main St',
        },
      }).expect(200);

      expect(locationResponse.body.errors).toBeUndefined();
      const locationId = locationResponse.body.data.createLocation.locationId;

      // Now create a preference tied to that location
      const mutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
            userId
            category
            key
            value
            locationId
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        data: {
          category: 'seating',
          key: 'preferred_section',
          value: 'outdoor patio',
          locationId,
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.createPreference).toMatchObject({
        userId: testUser.userId,
        category: 'seating',
        key: 'preferred_section',
        value: 'outdoor patio',
        locationId,
      });
    });

    it('should reject preference with missing category', async () => {
      const mutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        data: {
          key: 'allergies',
          value: ['peanuts'],
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('category');
    });

    it('should reject preference with missing key', async () => {
      const mutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        data: {
          category: 'dietary',
          value: ['peanuts'],
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('key');
    });
  });

  describe('preferences query', () => {
    it('should return all preferences for the user', async () => {
      // First create some preferences
      const createMutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
          }
        }
      `;

      await graphqlRequest(createMutation, {
        data: { category: 'travel', key: 'seat', value: 'aisle' },
      });

      await graphqlRequest(createMutation, {
        data: { category: 'travel', key: 'meal', value: 'vegetarian' },
      });

      // Query all preferences
      const query = `
        query {
          preferences {
            preferenceId
            userId
            category
            key
            value
          }
        }
      `;

      const response = await graphqlRequest(query).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.preferences).toBeInstanceOf(Array);
      expect(response.body.data.preferences.length).toBeGreaterThanOrEqual(2);

      // All should belong to test user
      response.body.data.preferences.forEach((pref: { userId: string }) => {
        expect(pref.userId).toBe(testUser.userId);
      });
    });
  });

  describe('preference query (single)', () => {
    it('should return a specific preference by ID', async () => {
      // Create a preference first
      const createMutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
            category
            key
            value
          }
        }
      `;

      const createResponse = await graphqlRequest(createMutation, {
        data: { category: 'music', key: 'genre', value: 'jazz' },
      });

      const preferenceId = createResponse.body.data.createPreference.preferenceId;

      // Query by ID
      const query = `
        query GetPreference($preferenceId: String!) {
          preference(preferenceId: $preferenceId) {
            preferenceId
            userId
            category
            key
            value
          }
        }
      `;

      const response = await graphqlRequest(query, { preferenceId }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.preference).toMatchObject({
        preferenceId,
        userId: testUser.userId,
        category: 'music',
        key: 'genre',
        value: 'jazz',
      });
    });
  });

  describe('preferencesByCategory query', () => {
    it('should return preferences filtered by category', async () => {
      // Create preferences in different categories
      const createMutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
          }
        }
      `;

      await graphqlRequest(createMutation, {
        data: { category: 'food', key: 'cuisine', value: 'italian' },
      });

      await graphqlRequest(createMutation, {
        data: { category: 'food', key: 'spice_level', value: 'medium' },
      });

      await graphqlRequest(createMutation, {
        data: { category: 'other', key: 'test', value: 'value' },
      });

      // Query by category
      const query = `
        query GetByCategory($category: String!) {
          preferencesByCategory(category: $category) {
            preferenceId
            category
            key
          }
        }
      `;

      const response = await graphqlRequest(query, { category: 'food' }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.preferencesByCategory.length).toBeGreaterThanOrEqual(2);
      response.body.data.preferencesByCategory.forEach((pref: { category: string }) => {
        expect(pref.category).toBe('food');
      });
    });
  });

  describe('globalPreferences query', () => {
    it('should return only preferences without locationId', async () => {
      const createMutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
          }
        }
      `;

      // Create global preference
      await graphqlRequest(createMutation, {
        data: { category: 'global_test', key: 'global_key', value: 'global_value' },
      });

      // Create location-scoped preference
      await graphqlRequest(createMutation, {
        data: {
          category: 'global_test',
          key: 'scoped_key',
          value: 'scoped_value',
          locationId: 'some-location',
        },
      });

      // Query global preferences
      const query = `
        query {
          globalPreferences {
            preferenceId
            category
            key
            locationId
          }
        }
      `;

      const response = await graphqlRequest(query).expect(200);

      expect(response.body.errors).toBeUndefined();
      response.body.data.globalPreferences.forEach((pref: { locationId: string | null }) => {
        expect(pref.locationId).toBeNull();
      });
    });
  });

  describe('updatePreference mutation', () => {
    it('should update an existing preference', async () => {
      // Create a preference
      const createMutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
          }
        }
      `;

      const createResponse = await graphqlRequest(createMutation, {
        data: { category: 'update_test', key: 'original', value: 'old_value' },
      });

      const preferenceId = createResponse.body.data.createPreference.preferenceId;

      // Update the preference
      const updateMutation = `
        mutation UpdatePreference($preferenceId: String!, $data: UpdatePreferenceInput!) {
          updatePreference(preferenceId: $preferenceId, data: $data) {
            preferenceId
            value
          }
        }
      `;

      const response = await graphqlRequest(updateMutation, {
        preferenceId,
        data: { value: 'new_value' },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.updatePreference).toMatchObject({
        preferenceId,
        value: 'new_value',
      });
    });
  });

  describe('deletePreference mutation', () => {
    it('should delete an existing preference', async () => {
      // Create a preference
      const createMutation = `
        mutation CreatePreference($data: CreatePreferenceInput!) {
          createPreference(data: $data) {
            preferenceId
          }
        }
      `;

      const createResponse = await graphqlRequest(createMutation, {
        data: { category: 'delete_test', key: 'to_delete', value: 'temp' },
      });

      const preferenceId = createResponse.body.data.createPreference.preferenceId;

      // Delete the preference
      const deleteMutation = `
        mutation DeletePreference($preferenceId: String!) {
          deletePreference(preferenceId: $preferenceId) {
            preferenceId
          }
        }
      `;

      const deleteResponse = await graphqlRequest(deleteMutation, {
        preferenceId,
      }).expect(200);

      expect(deleteResponse.body.errors).toBeUndefined();
      expect(deleteResponse.body.data.deletePreference.preferenceId).toBe(preferenceId);

      // Verify it's deleted by trying to fetch it
      const query = `
        query GetPreference($preferenceId: String!) {
          preference(preferenceId: $preferenceId) {
            preferenceId
          }
        }
      `;

      const getResponse = await graphqlRequest(query, { preferenceId }).expect(200);

      // Should return an error (preference not found)
      expect(getResponse.body.errors).toBeDefined();
    });
  });
});
