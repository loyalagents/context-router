import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';

describe('Document Analysis GraphQL API (e2e)', () => {
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

  describe('applyPreferenceSuggestions mutation', () => {
    it('should create preferences from CREATE operation suggestions', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
                slug
                value
                status
                category
              }
            }
          `,
          variables: {
            analysisId: 'analysis-123',
            input: [
              {
                suggestionId: 'suggestion-1',
                slug: 'food.dietary_restrictions',
                operation: 'CREATE',
                newValue: ['peanuts', 'shellfish'],
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0]).toMatchObject({
        slug: 'food.dietary_restrictions',
        value: ['peanuts', 'shellfish'],
        status: 'ACTIVE',
        category: 'food',
      });
    });

    it('should apply multiple CREATE suggestions in batch', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
                slug
                value
                category
              }
            }
          `,
          variables: {
            analysisId: 'analysis-456',
            input: [
              {
                suggestionId: 'suggestion-1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'casual',
              },
              {
                suggestionId: 'suggestion-2',
                slug: 'system.response_length',
                operation: 'CREATE',
                newValue: 'brief',
              },
              {
                suggestionId: 'suggestion-3',
                slug: 'food.spice_tolerance',
                operation: 'CREATE',
                newValue: 'medium',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(3);

      const categories = response.body.data.applyPreferenceSuggestions.map(
        (p: any) => p.category,
      );
      expect(categories).toContain('system');
      expect(categories).toContain('food');
    });

    it('should update preferences with UPDATE operation', async () => {
      // First create a preference using setPreference
      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation SetPreference($input: SetPreferenceInput!) {
              setPreference(input: $input) {
                id
                value
              }
            }
          `,
          variables: {
            input: {
              slug: 'system.response_tone',
              value: 'casual',
            },
          },
        });

      // Now update using the suggestion
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
                slug
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-789',
            input: [
              {
                suggestionId: 'suggestion-update',
                slug: 'system.response_tone',
                operation: 'UPDATE',
                newValue: 'professional',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0].value).toBe(
        'professional',
      );

      // Verify the preference was updated by querying for it
      const getResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query GetPreferences {
              activePreferences {
                id
                slug
                value
              }
            }
          `,
        })
        .expect(200);

      const tonePref = getResponse.body.data.activePreferences.find(
        (p: any) => p.slug === 'system.response_tone',
      );
      expect(tonePref.value).toBe('professional');
    });

    it('should handle mixed CREATE and UPDATE operations', async () => {
      // First create an existing preference
      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation SetPreference($input: SetPreferenceInput!) {
              setPreference(input: $input) {
                id
              }
            }
          `,
          variables: {
            input: {
              slug: 'travel.seat_preference',
              value: 'middle',
            },
          },
        });

      // Apply mixed suggestions
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
                slug
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-mixed',
            input: [
              {
                suggestionId: 'new-pref',
                slug: 'travel.meal_preference',
                operation: 'CREATE',
                newValue: 'vegetarian',
              },
              {
                suggestionId: 'update-pref',
                slug: 'travel.seat_preference',
                operation: 'UPDATE',
                newValue: 'aisle',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(2);

      const meal = response.body.data.applyPreferenceSuggestions.find(
        (p: any) => p.slug === 'travel.meal_preference',
      );
      const seat = response.body.data.applyPreferenceSuggestions.find(
        (p: any) => p.slug === 'travel.seat_preference',
      );

      expect(meal.value).toBe('vegetarian');
      expect(seat.value).toBe('aisle');
    });

    it('should handle array values', async () => {
      const arrayValue = ['TypeScript', 'Node.js', 'React'];

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
                slug
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-array',
            input: [
              {
                suggestionId: 'array-suggestion',
                slug: 'dev.tech_stack',
                operation: 'CREATE',
                newValue: arrayValue,
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0].value).toEqual(
        arrayValue,
      );
    });

    it('should return empty array when no suggestions are provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
              }
            }
          `,
          variables: {
            analysisId: 'analysis-empty',
            input: [],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toEqual([]);
    });

    it('should validate required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
              }
            }
          `,
          variables: {
            analysisId: 'analysis-invalid',
            input: [
              {
                suggestionId: 'invalid',
                // Missing slug, operation
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
    });

    it('should validate operation enum', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
              }
            }
          `,
          variables: {
            analysisId: 'analysis-invalid-op',
            input: [
              {
                suggestionId: 'invalid-op',
                slug: 'food.dietary_restrictions',
                operation: 'INVALID_OPERATION',
                newValue: ['test'],
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('PreferenceOperation');
    });

    it('should reject unknown slug', async () => {
      // The applyPreferenceSuggestions mutation catches errors internally and continues
      // processing other suggestions. When an unknown slug is encountered, it's logged
      // as an error but doesn't return a GraphQL error - instead, the invalid suggestion
      // is simply not included in the results.
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                id
                slug
              }
            }
          `,
          variables: {
            analysisId: 'analysis-unknown-slug',
            input: [
              {
                suggestionId: 'unknown-slug',
                slug: 'unknown.invalid_category',
                operation: 'CREATE',
                newValue: 'test',
              },
            ],
          },
        })
        .expect(200);

      // No GraphQL errors - the resolver catches and logs errors internally
      expect(response.body.errors).toBeUndefined();
      // The unknown slug should not appear in results (it was rejected internally)
      expect(response.body.data.applyPreferenceSuggestions).toEqual([]);
    });
  });
});
