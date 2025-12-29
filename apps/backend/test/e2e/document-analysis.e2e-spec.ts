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
                preferenceId
                category
                key
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-123',
            input: [
              {
                suggestionId: 'suggestion-1',
                key: 'allergies',
                category: 'dietary',
                operation: 'CREATE',
                newValue: ['peanuts', 'shellfish'],
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0]).toMatchObject({
        category: 'dietary',
        key: 'allergies',
        value: ['peanuts', 'shellfish'],
      });
    });

    it('should apply multiple CREATE suggestions in batch', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                preferenceId
                category
                key
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-456',
            input: [
              {
                suggestionId: 'suggestion-1',
                key: 'theme',
                category: 'appearance',
                operation: 'CREATE',
                newValue: 'dark',
              },
              {
                suggestionId: 'suggestion-2',
                key: 'fontSize',
                category: 'appearance',
                operation: 'CREATE',
                newValue: 16,
              },
              {
                suggestionId: 'suggestion-3',
                key: 'currency',
                category: 'finance',
                operation: 'CREATE',
                newValue: 'USD',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(3);

      const categories = response.body.data.applyPreferenceSuggestions.map(
        (p: any) => p.category,
      );
      expect(categories).toContain('appearance');
      expect(categories).toContain('finance');
    });

    it('should update preferences with UPDATE operation', async () => {
      // First create a preference
      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreatePreference($data: CreatePreferenceInput!) {
              createPreference(data: $data) {
                preferenceId
                value
              }
            }
          `,
          variables: {
            data: {
              category: 'appearance',
              key: 'theme',
              value: 'light',
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
                preferenceId
                category
                key
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-789',
            input: [
              {
                suggestionId: 'suggestion-update',
                key: 'theme',
                category: 'appearance',
                operation: 'UPDATE',
                newValue: 'dark',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0].value).toBe(
        'dark',
      );

      // Verify the preference was updated by querying for it
      const getResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query GetPreferences {
              preferences {
                preferenceId
                category
                key
                value
              }
            }
          `,
        })
        .expect(200);

      const themePreference = getResponse.body.data.preferences.find(
        (p: any) => p.key === 'theme',
      );
      expect(themePreference.value).toBe('dark');
    });

    it('should handle mixed CREATE and UPDATE operations', async () => {
      // First create an existing preference
      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreatePreference($data: CreatePreferenceInput!) {
              createPreference(data: $data) {
                preferenceId
              }
            }
          `,
          variables: {
            data: {
              category: 'notifications',
              key: 'email',
              value: false,
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
                preferenceId
                category
                key
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-mixed',
            input: [
              {
                suggestionId: 'new-pref',
                key: 'sms',
                category: 'notifications',
                operation: 'CREATE',
                newValue: true,
              },
              {
                suggestionId: 'update-pref',
                key: 'email',
                category: 'notifications',
                operation: 'UPDATE',
                newValue: true,
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(2);

      const sms = response.body.data.applyPreferenceSuggestions.find(
        (p: any) => p.key === 'sms',
      );
      const email = response.body.data.applyPreferenceSuggestions.find(
        (p: any) => p.key === 'email',
      );

      expect(sms.value).toBe(true);
      expect(email.value).toBe(true);
    });

    it('should handle complex JSON values', async () => {
      const complexValue = {
        schedule: {
          monday: ['09:00', '17:00'],
          tuesday: ['10:00', '18:00'],
        },
        timezone: 'America/New_York',
        enabled: true,
      };

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                preferenceId
                category
                key
                value
              }
            }
          `,
          variables: {
            analysisId: 'analysis-complex',
            input: [
              {
                suggestionId: 'complex-suggestion',
                key: 'workHours',
                category: 'schedule',
                operation: 'CREATE',
                newValue: complexValue,
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0].value).toEqual(
        complexValue,
      );
    });

    it('should return empty array when no suggestions are provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                preferenceId
              }
            }
          `,
          variables: {
            analysisId: 'analysis-empty',
            input: [],
          },
        })
        .expect(200);

      expect(response.body.data.applyPreferenceSuggestions).toEqual([]);
    });

    it('should validate required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
              applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
                preferenceId
              }
            }
          `,
          variables: {
            analysisId: 'analysis-invalid',
            input: [
              {
                suggestionId: 'invalid',
                // Missing key, category, operation
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
                preferenceId
              }
            }
          `,
          variables: {
            analysisId: 'analysis-invalid-op',
            input: [
              {
                suggestionId: 'invalid-op',
                key: 'test',
                category: 'test',
                operation: 'INVALID_OPERATION',
                newValue: 'test',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('PreferenceOperation');
    });
  });
});
