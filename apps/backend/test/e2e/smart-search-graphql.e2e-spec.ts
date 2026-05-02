import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  createTestUser,
  TestUser,
  createMockStructuredAiService,
} from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import {
  LocationType,
  Prisma,
  PreferenceStatus,
  PreferenceScope,
  PreferenceValueType,
  SourceType,
} from '../../src/infrastructure/prisma/generated-client';

describe('Smart Search GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let mocks: {
    structuredAi: ReturnType<typeof createMockStructuredAiService>;
    [key: string]: any;
  };
  const prisma = getPrismaClient();

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    mocks = testApp.mocks;
  });

  beforeEach(async () => {
    testUser = await createTestUser();
    setTestUser(testUser);
    mocks.structuredAi.generateStructured.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables });

  const SMART_SEARCH_QUERY = `
    query SmartSearchPreferences($input: SmartPreferenceSearchInput!) {
      smartSearchPreferences(input: $input) {
        queryInterpretation
        matchedDefinitions {
          slug
          description
          category
        }
        matchedActivePreferences {
          id
          userId
          slug
          value
          status
          sourceType
          confidence
          locationId
          category
          description
        }
        matchedSuggestedPreferences {
          id
          userId
          slug
          value
          status
          sourceType
          confidence
          locationId
          category
          description
        }
      }
    }
  `;

  const findDefinition = async (slug: string) => {
    const definition = await prisma.preferenceDefinition.findFirst({
      where: { slug },
    });
    if (!definition) {
      throw new Error(`Missing seeded preference definition ${slug}`);
    }
    return definition;
  };

  const createPreference = async ({
    userId = testUser.userId,
    slug,
    value,
    status = PreferenceStatus.ACTIVE,
    sourceType = SourceType.USER,
    confidence,
    locationId,
  }: {
    userId?: string;
    slug: string;
    value: Prisma.InputJsonValue;
    status?: PreferenceStatus;
    sourceType?: SourceType;
    confidence?: number;
    locationId?: string;
  }) => {
    const definition = await findDefinition(slug);
    return prisma.preference.create({
      data: {
        userId,
        definitionId: definition.id,
        locationId,
        contextKey: locationId ? `LOCATION:${locationId}` : 'GLOBAL',
        value,
        status,
        sourceType,
        confidence,
      },
    });
  };

  const createUserDefinition = async ({
    slug,
    description,
    valueType = PreferenceValueType.STRING,
    scope = PreferenceScope.GLOBAL,
  }: {
    slug: string;
    description: string;
    valueType?: PreferenceValueType;
    scope?: PreferenceScope;
  }) =>
    prisma.preferenceDefinition.create({
      data: {
        namespace: `USER:${testUser.userId}`,
        ownerUserId: testUser.userId,
        slug,
        description,
        valueType,
        scope,
        isCore: false,
      },
    });

  it('returns matched definitions and active preferences, including definitions without stored values', async () => {
    await createPreference({
      slug: 'food.dietary_restrictions',
      value: ['peanuts'],
    });

    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'food.dietary_restrictions',
        'food.cuisine_preferences',
      ],
      queryInterpretation: 'Food preferences for event registration',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'I am registering this person for a conference',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const result = response.body.data.smartSearchPreferences;
    expect(result.queryInterpretation).toBe(
      'Food preferences for event registration',
    );
    expect(result.matchedDefinitions.map((d: { slug: string }) => d.slug)).toEqual([
      'food.dietary_restrictions',
      'food.cuisine_preferences',
    ]);
    expect(result.matchedActivePreferences).toHaveLength(1);
    expect(result.matchedActivePreferences[0]).toMatchObject({
      userId: testUser.userId,
      slug: 'food.dietary_restrictions',
      value: ['peanuts'],
      status: 'ACTIVE',
      sourceType: 'USER',
      category: 'food',
    });
    expect(result.matchedSuggestedPreferences).toEqual([]);
  });

  it('returns suggested preferences when requested', async () => {
    await createPreference({
      slug: 'food.dietary_restrictions',
      value: ['shellfish'],
    });
    await createPreference({
      slug: 'food.cuisine_preferences',
      value: ['Japanese'],
      status: PreferenceStatus.SUGGESTED,
      sourceType: SourceType.INFERRED,
      confidence: 0.82,
    });

    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'food.dietary_restrictions',
        'food.cuisine_preferences',
      ],
      queryInterpretation: 'Food preferences',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'What food should I order?',
        includeSuggestions: true,
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const result = response.body.data.smartSearchPreferences;
    expect(result.matchedActivePreferences).toHaveLength(1);
    expect(result.matchedSuggestedPreferences).toHaveLength(1);
    expect(result.matchedSuggestedPreferences[0]).toMatchObject({
      slug: 'food.cuisine_preferences',
      value: ['Japanese'],
      status: 'SUGGESTED',
      sourceType: 'INFERRED',
      confidence: 0.82,
    });
  });

  it('omits suggested preferences when includeSuggestions is false', async () => {
    await createPreference({
      slug: 'food.cuisine_preferences',
      value: ['Thai'],
      status: PreferenceStatus.SUGGESTED,
      sourceType: SourceType.INFERRED,
      confidence: 0.72,
    });

    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.cuisine_preferences'],
      queryInterpretation: 'Food preferences',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'What food should I order?',
        includeSuggestions: false,
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const result = response.body.data.smartSearchPreferences;
    expect(result.matchedDefinitions.map((d: { slug: string }) => d.slug)).toEqual([
      'food.cuisine_preferences',
    ]);
    expect(result.matchedActivePreferences).toEqual([]);
    expect(result.matchedSuggestedPreferences).toEqual([]);
  });

  it('uses location-specific active preferences when locationId is provided', async () => {
    const location = await prisma.location.create({
      data: {
        userId: testUser.userId,
        type: LocationType.HOME,
        label: 'Home',
        address: '123 Test St',
      },
    });

    await createPreference({
      slug: 'location.default_temperature',
      value: '72',
    });
    await createPreference({
      slug: 'location.default_temperature',
      value: '68',
      locationId: location.locationId,
    });

    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: ['location.default_temperature'],
      queryInterpretation: 'Location comfort preferences',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'How warm should this place be?',
        locationId: location.locationId,
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const result = response.body.data.smartSearchPreferences;
    expect(result.matchedActivePreferences).toHaveLength(1);
    expect(result.matchedActivePreferences[0]).toMatchObject({
      slug: 'location.default_temperature',
      value: '68',
      locationId: location.locationId,
    });
    expect(JSON.stringify(result)).not.toContain('72');
  });

  it('returns user-owned definitions and preferences', async () => {
    const definition = await createUserDefinition({
      slug: 'apparel.shirt_size',
      description: 'Preferred shirt size for apparel purchases.',
    });

    await prisma.preference.create({
      data: {
        userId: testUser.userId,
        definitionId: definition.id,
        contextKey: 'GLOBAL',
        value: 'medium',
        status: PreferenceStatus.ACTIVE,
        sourceType: SourceType.USER,
      },
    });

    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: ['apparel.shirt_size'],
      queryInterpretation: 'Clothing purchase preferences',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'I am buying this person a shirt',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const result = response.body.data.smartSearchPreferences;
    expect(result.matchedDefinitions).toEqual([
      {
        slug: 'apparel.shirt_size',
        description: 'Preferred shirt size for apparel purchases.',
        category: 'apparel',
      },
    ]);
    expect(result.matchedActivePreferences).toHaveLength(1);
    expect(result.matchedActivePreferences[0]).toMatchObject({
      slug: 'apparel.shirt_size',
      value: 'medium',
      category: 'apparel',
    });
  });

  it('drops hallucinated slugs and preserves valid matches', async () => {
    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'food.dietary_restrictions',
        'food.completely_made_up',
      ],
      queryInterpretation: 'Food preferences',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'food preferences',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const result = response.body.data.smartSearchPreferences;
    expect(result.matchedDefinitions.map((d: { slug: string }) => d.slug)).toEqual([
      'food.dietary_restrictions',
    ]);
    expect(result.matchedActivePreferences).toEqual([]);
    expect(result.matchedSuggestedPreferences).toEqual([]);
  });

  it('returns empty arrays when AI finds no relevant slugs', async () => {
    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: [],
      queryInterpretation: 'No relevant stored preference categories',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'something unrelated',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.smartSearchPreferences).toEqual({
      queryInterpretation: 'No relevant stored preference categories',
      matchedDefinitions: [],
      matchedActivePreferences: [],
      matchedSuggestedPreferences: [],
    });
  });

  it('scopes active preferences to the authenticated user', async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: 'smart-search-other@example.com',
      },
    });

    await createPreference({
      slug: 'travel.seat_preference',
      value: 'aisle',
    });
    await createPreference({
      userId: otherUser.userId,
      slug: 'travel.seat_preference',
      value: 'window',
    });

    mocks.structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: ['travel.seat_preference'],
      queryInterpretation: 'Flight booking preferences',
    });

    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: 'I am booking a flight',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const result = response.body.data.smartSearchPreferences;
    expect(result.matchedActivePreferences).toHaveLength(1);
    expect(result.matchedActivePreferences[0]).toMatchObject({
      userId: testUser.userId,
      slug: 'travel.seat_preference',
      value: 'aisle',
    });
    expect(JSON.stringify(result)).not.toContain('window');
  });

  it('rejects an empty smart search query', async () => {
    const response = await graphqlRequest(SMART_SEARCH_QUERY, {
      input: {
        query: '',
      },
    }).expect(200);

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toBe('Bad Request Exception');
    expect(mocks.structuredAi.generateStructured).not.toHaveBeenCalled();
  });
});
