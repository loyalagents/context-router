import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
} from '../../src/infrastructure/prisma/generated-client';

describe('Document Analysis API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let structuredAi: {
    generateStructured: jest.Mock;
    generateStructuredWithFile: jest.Mock;
  };
  const prisma = getPrismaClient();

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    structuredAi = testApp.mocks.structuredAi;
  });

  beforeEach(async () => {
    // Create fresh user after resetDb()
    testUser = await createTestUser();
    setTestUser(testUser);
    structuredAi.generateStructured.mockReset();
    structuredAi.generateStructuredWithFile.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('analyzeDocument REST endpoint', () => {
    it('should accept markdown uploads', async () => {
      structuredAi.generateStructuredWithFile.mockResolvedValue({
        suggestions: [],
        documentSummary: 'Markdown preference notes',
      });

      const response = await request(app.getHttpServer())
        .post('/api/preferences/analysis')
        .attach('file', Buffer.from('# Preferences\n- Keep replies brief\n'), {
          filename: 'preferences.md',
          contentType: 'text/markdown',
        })
        .expect(201);

      expect(response.body.status).toBe('no_matches');
      expect(response.body.documentSummary).toBe('Markdown preference notes');
      expect(structuredAi.generateStructuredWithFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          mimeType: 'text/markdown',
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it.each([
      ['application/yaml', 'preferences.yaml'],
      ['text/yaml', 'preferences.yml'],
      ['application/x-yaml', 'preferences.yaml'],
    ])('should accept YAML uploads with MIME %s', async (contentType, filename) => {
      structuredAi.generateStructuredWithFile.mockResolvedValue({
        suggestions: [],
        documentSummary: 'YAML preference notes',
      });

      const response = await request(app.getHttpServer())
        .post('/api/preferences/analysis')
        .attach('file', Buffer.from('tone: brief\nlocale: en-US\n'), {
          filename,
          contentType,
        })
        .expect(201);

      expect(response.body.status).toBe('no_matches');
      expect(response.body.documentSummary).toBe('YAML preference notes');
      expect(structuredAi.generateStructuredWithFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          mimeType: contentType,
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should reject unsupported upload MIME types', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/preferences/analysis')
        .attach('file', Buffer.from('binary-ish'), {
          filename: 'preferences.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        .expect(400);

      expect(response.body.message).toContain('Unsupported file type');
      expect(response.body.message).toContain('text/markdown');
      expect(response.body.message).toContain('application/yaml');
    });

    it('should consolidate duplicate candidates and preserve stable IDs', async () => {
      structuredAi.generateStructuredWithFile.mockResolvedValue({
        suggestions: [
          {
            slug: 'food.dietary_restrictions',
            operation: 'CREATE',
            newValue: ['peanuts'],
            confidence: 0.8,
            sourceSnippet: 'allergic to peanuts',
            sourceMeta: { page: 1, line: 2 },
          },
          {
            slug: 'food.dietary_restrictions',
            operation: 'CREATE',
            newValue: ['shellfish'],
            confidence: 0.87,
            sourceSnippet: 'allergic to shellfish',
            sourceMeta: { page: 2, line: 4 },
          },
          {
            slug: 'system.response_tone',
            operation: 'CREATE',
            newValue: 'casual',
            confidence: 0.92,
            sourceSnippet: 'likes casual replies',
            sourceMeta: { page: 3, line: 1 },
          },
        ],
        documentSummary: 'Customer preference notes',
      });
      structuredAi.generateStructured.mockResolvedValue({
        suggestion: {
          slug: 'food.dietary_restrictions',
          operation: 'CREATE',
          newValue: ['peanuts', 'shellfish'],
          confidence: 0.95,
          sourceSnippet: 'allergic to shellfish',
          sourceMeta: { page: 2, line: 4 },
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/preferences/analysis')
        .attach('file', Buffer.from('allergic to peanuts and shellfish'), {
          filename: 'preferences.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      expect(response.body.status).toBe('success');
      expect(response.body.documentSummary).toBe('Customer preference notes');
      expect(response.body.suggestions).toHaveLength(2);
      expect(response.body.filteredSuggestions).toHaveLength(2);
      expect(response.body.filteredCount).toBe(2);

      const analysisId = response.body.analysisId;
      const consolidated = response.body.suggestions.find(
        (suggestion: any) =>
          suggestion.slug === 'food.dietary_restrictions',
      );
      const ordinary = response.body.suggestions.find(
        (suggestion: any) => suggestion.slug === 'system.response_tone',
      );

      expect(consolidated).toMatchObject({
        id: `${analysisId}:consolidated:food.dietary_restrictions`,
        newValue: ['peanuts', 'shellfish'],
        confidence: 0.95,
        sourceSnippet: 'allergic to shellfish',
      });
      expect(ordinary).toMatchObject({
        id: `${analysisId}:candidate:2`,
        newValue: 'casual',
        sourceSnippet: 'likes casual replies',
      });
      expect(response.body.filteredSuggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `${analysisId}:filtered:duplicate:food.dietary_restrictions:0`,
            filterReason: 'DUPLICATE_KEY',
            sourceSnippet: 'allergic to peanuts',
            sourceMeta: { page: 1, line: 2 },
          }),
          expect.objectContaining({
            id: `${analysisId}:filtered:duplicate:food.dietary_restrictions:1`,
            filterReason: 'DUPLICATE_KEY',
            sourceSnippet: 'allergic to shellfish',
            sourceMeta: { page: 2, line: 4 },
          }),
        ]),
      );
      expect(structuredAi.generateStructured).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyPreferenceSuggestions mutation', () => {
    it('should create preferences from CREATE operation suggestions', async () => {
      const analysisId = 'analysis-123';
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
            analysisId,
            input: [
              {
                suggestionId: 'suggestion-1',
                slug: 'food.dietary_restrictions',
                operation: 'CREATE',
                newValue: ['peanuts', 'shellfish'],
                confidence: 0.88,
                evidence: { source: 'document', snippet: 'allergic to peanuts and shellfish' },
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

      const activeRow = await prisma.preference.findUnique({
        where: { id: response.body.data.applyPreferenceSuggestions[0].id },
      });

      expect(activeRow).toMatchObject({
        sourceType: 'INFERRED',
        confidence: 0.88,
        evidence: {
          source: 'document',
          snippet: 'allergic to peanuts and shellfish',
        },
      });

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: { correlationId: analysisId },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        eventType: AuditEventType.PREFERENCE_SET,
        origin: AuditOrigin.DOCUMENT_ANALYSIS,
        actorType: AuditActorType.USER,
        correlationId: analysisId,
      });
      expect(auditRows[0].afterState).toMatchObject({
        sourceType: 'INFERRED',
        confidence: 0.88,
        evidence: {
          source: 'document',
          snippet: 'allergic to peanuts and shellfish',
        },
      });
    });

    it('should apply multiple CREATE suggestions in batch', async () => {
      const analysisId = 'analysis-456';
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
            analysisId,
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

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: { correlationId: analysisId },
      });

      expect(auditRows).toHaveLength(3);
      expect(
        auditRows.map((auditRow) => auditRow.correlationId),
      ).toEqual([analysisId, analysisId, analysisId]);
      expect(
        auditRows.map((auditRow) => auditRow.eventType),
      ).toEqual([
        AuditEventType.PREFERENCE_SET,
        AuditEventType.PREFERENCE_SET,
        AuditEventType.PREFERENCE_SET,
      ]);
      expect(
        auditRows.map((auditRow) => auditRow.origin),
      ).toEqual([
        AuditOrigin.DOCUMENT_ANALYSIS,
        AuditOrigin.DOCUMENT_ANALYSIS,
        AuditOrigin.DOCUMENT_ANALYSIS,
      ]);
      expect(
        auditRows.map((auditRow) => (auditRow.afterState as { slug?: string }).slug),
      ).toEqual(
        expect.arrayContaining([
          'system.response_tone',
          'system.response_length',
          'food.spice_tolerance',
        ]),
      );
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

    it('should canonicalize duplicated array members when applying suggestions', async () => {
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
            analysisId: 'analysis-array-canonicalized',
            input: [
              {
                suggestionId: 'array-canonicalized',
                slug: 'dev.tech_stack',
                operation: 'CREATE',
                newValue: ['AI', ' software engineering ', 'AI', ''],
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0].value).toEqual([
        'AI',
        'software engineering',
      ]);
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

    it('should write audit rows only for successful mutations in a partial-failure batch', async () => {
      const analysisId = 'analysis-partial-failure';
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
            analysisId,
            input: [
              {
                suggestionId: 'valid-suggestion',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'casual',
                confidence: 0.73,
                evidence: { source: 'pdf', page: 1 },
              },
              {
                suggestionId: 'invalid-suggestion',
                slug: 'unknown.invalid_category',
                operation: 'CREATE',
                newValue: 'bad',
                confidence: 0.11,
                evidence: { source: 'pdf', page: 2 },
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.applyPreferenceSuggestions).toHaveLength(1);
      expect(response.body.data.applyPreferenceSuggestions[0]).toMatchObject({
        slug: 'system.response_tone',
        value: 'casual',
      });

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: { correlationId: analysisId },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        eventType: AuditEventType.PREFERENCE_SET,
        origin: AuditOrigin.DOCUMENT_ANALYSIS,
      });
      expect(auditRows[0].afterState).toMatchObject({
        slug: 'system.response_tone',
        value: 'casual',
      });
    });
  });
});
