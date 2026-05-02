import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
  Prisma,
} from '../../src/infrastructure/prisma/generated-client';

const TEST_CLIENT_IDS = {
  claude: process.env.AUTH0_MCP_CLAUDE_CLIENT_ID!,
  codex: process.env.AUTH0_MCP_CODEX_CLIENT_ID!,
};

describe('Preference Audit History GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  const prisma = getPrismaClient();

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
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  const mcpPost = (body: object, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(headers)
      .send(body);

  const mcpHeaders = (clientId: string) => ({
    'x-test-mcp-client-id': clientId,
  });

  const CREATE_DEFINITION_MUTATION = `
    mutation CreatePreferenceDefinition($input: CreatePreferenceDefinitionInput!) {
      createPreferenceDefinition(input: $input) {
        id
        slug
      }
    }
  `;

  const UPDATE_DEFINITION_MUTATION = `
    mutation UpdatePreferenceDefinition($id: ID!, $input: UpdatePreferenceDefinitionInput!) {
      updatePreferenceDefinition(id: $id, input: $input) {
        id
      }
    }
  `;

  const ARCHIVE_DEFINITION_MUTATION = `
    mutation ArchivePreferenceDefinition($id: ID!) {
      archivePreferenceDefinition(id: $id) {
        id
      }
    }
  `;

  const SET_PREFERENCE_MUTATION = `
    mutation SetPreference($input: SetPreferenceInput!) {
      setPreference(input: $input) {
        id
      }
    }
  `;

  const SUGGEST_PREFERENCE_MUTATION = `
    mutation SuggestPreference($input: SuggestPreferenceInput!) {
      suggestPreference(input: $input) {
        id
      }
    }
  `;

  const ACCEPT_SUGGESTION_MUTATION = `
    mutation AcceptSuggestedPreference($id: ID!) {
      acceptSuggestedPreference(id: $id) {
        id
      }
    }
  `;

  const REJECT_SUGGESTION_MUTATION = `
    mutation RejectSuggestedPreference($id: ID!) {
      rejectSuggestedPreference(id: $id)
    }
  `;

  const DELETE_PREFERENCE_MUTATION = `
    mutation DeletePreference($id: ID!) {
      deletePreference(id: $id) {
        id
      }
    }
  `;

  const APPLY_SUGGESTIONS_MUTATION = `
    mutation ApplyPreferenceSuggestions($analysisId: ID!, $input: [ApplyPreferenceSuggestionInput!]!) {
      applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
        id
        slug
      }
    }
  `;

  const AUDIT_HISTORY_QUERY = `
    query PreferenceAuditHistory($input: PreferenceAuditHistoryInput!) {
      preferenceAuditHistory(input: $input) {
        hasNextPage
        nextCursor
        items {
          id
          userId
          subjectSlug
          occurredAt
          targetType
          targetId
          eventType
          actorType
          actorClientKey
          origin
          correlationId
          beforeState
          afterState
          metadata
        }
      }
    }
  `;

  async function createDefinition(slug: string) {
    const response = await graphqlRequest(CREATE_DEFINITION_MUTATION, {
      input: {
        slug,
        description: 'Audit history test definition',
        valueType: 'STRING',
        scope: 'GLOBAL',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    return response.body.data.createPreferenceDefinition.id as string;
  }

  async function seedAuditEvent(params: {
    id: string;
    userId?: string;
    subjectSlug: string;
    targetType: AuditTargetType;
    targetId: string;
    eventType: AuditEventType;
    occurredAt: Date;
    actorType?: AuditActorType;
    actorClientKey?: string | null;
    origin?: AuditOrigin;
    correlationId?: string;
    beforeState?: Prisma.InputJsonValue | null;
    afterState?: Prisma.InputJsonValue | null;
    metadata?: Prisma.InputJsonValue | null;
  }) {
    return prisma.preferenceAuditEvent.create({
      data: {
        id: params.id,
        userId: params.userId ?? testUser.userId,
        subjectSlug: params.subjectSlug,
        targetType: params.targetType,
        targetId: params.targetId,
        eventType: params.eventType,
        actorType: params.actorType ?? AuditActorType.USER,
        actorClientKey: params.actorClientKey ?? null,
        origin: params.origin ?? AuditOrigin.GRAPHQL,
        correlationId: params.correlationId ?? `corr-${params.id}`,
        occurredAt: params.occurredAt,
        beforeState: params.beforeState ?? undefined,
        afterState: params.afterState ?? undefined,
        metadata: params.metadata ?? undefined,
      },
    });
  }

  it('returns mixed slug history across preference and definition events and narrows with targetType', async () => {
    const slug = 'custom.audit_history';
    const definitionId = await createDefinition(slug);

    await graphqlRequest(UPDATE_DEFINITION_MUTATION, {
      id: definitionId,
      input: { description: 'Updated audit history definition' },
    }).expect(200);

    const setResponse = await graphqlRequest(SET_PREFERENCE_MUTATION, {
      input: {
        slug,
        value: 'initial',
      },
    }).expect(200);
    expect(setResponse.body.errors).toBeUndefined();
    const activePreferenceId = setResponse.body.data.setPreference.id as string;

    const firstSuggestionResponse = await graphqlRequest(
      SUGGEST_PREFERENCE_MUTATION,
      {
        input: {
          slug,
          value: 'accepted',
          confidence: 0.9,
        },
      },
    ).expect(200);
    expect(firstSuggestionResponse.body.errors).toBeUndefined();
    const acceptedSuggestionId = firstSuggestionResponse.body.data
      .suggestPreference.id as string;

    await graphqlRequest(ACCEPT_SUGGESTION_MUTATION, {
      id: acceptedSuggestionId,
    }).expect(200);

    await graphqlRequest(DELETE_PREFERENCE_MUTATION, {
      id: activePreferenceId,
    }).expect(200);

    const secondSuggestionResponse = await graphqlRequest(
      SUGGEST_PREFERENCE_MUTATION,
      {
        input: {
          slug,
          value: 'rejected',
          confidence: 0.7,
        },
      },
    ).expect(200);
    expect(secondSuggestionResponse.body.errors).toBeUndefined();
    const rejectedSuggestionId = secondSuggestionResponse.body.data
      .suggestPreference.id as string;

    await graphqlRequest(REJECT_SUGGESTION_MUTATION, {
      id: rejectedSuggestionId,
    }).expect(200);

    await graphqlRequest(ARCHIVE_DEFINITION_MUTATION, {
      id: definitionId,
    }).expect(200);

    const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: slug,
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const page = response.body.data.preferenceAuditHistory;

    expect(page.hasNextPage).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(9);
    expect(page.items.every((item: any) => item.subjectSlug === slug)).toBe(
      true,
    );
    expect(page.items.map((item: any) => item.eventType)).toEqual(
      expect.arrayContaining([
        'DEFINITION_CREATED',
        'DEFINITION_UPDATED',
        'PREFERENCE_SET',
        'PREFERENCE_SUGGESTED_UPSERTED',
        'PREFERENCE_SUGGESTION_ACCEPTED',
        'PREFERENCE_DELETED',
        'PREFERENCE_SUGGESTION_REJECTED',
        'DEFINITION_ARCHIVED',
      ]),
    );
    expect(page.items.map((item: any) => item.targetType)).toEqual(
      expect.arrayContaining(['PREFERENCE', 'PREFERENCE_DEFINITION']),
    );

    const preferenceOnlyResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: slug,
        targetType: 'PREFERENCE',
      },
    }).expect(200);

    expect(preferenceOnlyResponse.body.errors).toBeUndefined();
    expect(
      preferenceOnlyResponse.body.data.preferenceAuditHistory.items.every(
        (item: any) => item.targetType === 'PREFERENCE',
      ),
    ).toBe(true);
  });

  it('filters audit history by actorClientKey for MCP-originated events', async () => {
    await mcpPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'mutatePreferences',
          arguments: {
            operation: 'SUGGEST_PREFERENCE',
            preference: {
              slug: 'food.dietary_restrictions',
              value: '["nuts"]',
              confidence: 0.9,
            },
          },
        },
      },
      mcpHeaders(TEST_CLIENT_IDS.codex),
    ).expect(200);

    await mcpPost(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'mutatePreferences',
          arguments: {
            operation: 'SUGGEST_PREFERENCE',
            preference: {
              slug: 'system.response_tone',
              value: '"concise"',
              confidence: 0.8,
            },
          },
        },
      },
      mcpHeaders(TEST_CLIENT_IDS.claude),
    ).expect(200);

    const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        actorClientKey: 'codex',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const items = response.body.data.preferenceAuditHistory.items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actorClientKey: 'codex',
      origin: 'MCP',
      eventType: 'PREFERENCE_SUGGESTED_UPSERTED',
    });
  });

  it('filters audit history by DOCUMENT_ANALYSIS origin', async () => {
    const response = await graphqlRequest(APPLY_SUGGESTIONS_MUTATION, {
      analysisId: 'analysis-1',
      input: [
        {
          suggestionId: 'suggestion-1',
          slug: 'food.dietary_restrictions',
          operation: 'CREATE',
          newValue: ['sesame'],
        },
      ],
    }).expect(200);

    expect(response.body.errors).toBeUndefined();

    const auditResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        origin: 'DOCUMENT_ANALYSIS',
      },
    }).expect(200);

    expect(auditResponse.body.errors).toBeUndefined();
    const items = auditResponse.body.data.preferenceAuditHistory.items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      origin: 'DOCUMENT_ANALYSIS',
      subjectSlug: 'food.dietary_restrictions',
      eventType: 'PREFERENCE_SET',
    });
  });

  it('returns a clean empty page for a slug with no history', async () => {
    const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: 'missing.slug',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.preferenceAuditHistory).toEqual({
      hasNextPage: false,
      nextCursor: null,
      items: [],
    });
  });

  it('matches subjectSlug by prefix so food. returns all food.* audit rows', async () => {
    await seedAuditEvent({
      id: 'audit-food-1',
      subjectSlug: 'food.dietary_restrictions',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-food-1',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T10:00:00.000Z'),
    });
    await seedAuditEvent({
      id: 'audit-food-2',
      subjectSlug: 'food.favorite_cuisine',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-food-2',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T11:00:00.000Z'),
    });
    await seedAuditEvent({
      id: 'audit-system-1',
      subjectSlug: 'system.response_tone',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-system-1',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T12:00:00.000Z'),
    });

    const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: 'food.',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const items = response.body.data.preferenceAuditHistory.items;
    expect(items.map((item: any) => item.id)).toEqual([
      'audit-food-2',
      'audit-food-1',
    ]);
    expect(
      items.every((item: any) => item.subjectSlug.startsWith('food.')),
    ).toBe(true);
  });

  it('returns a clear GraphQL error for malformed cursors', async () => {
    const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        after: 'bad-cursor',
      },
    }).expect(200);

    expect(response.body.data).toBeNull();
    expect(response.body.errors).toBeDefined();
    expect(response.body.errors[0].message).toContain(
      'Invalid audit history cursor',
    );
  });

  it.each([0, 101])(
    'rejects first=%s outside the supported page-size range',
    async (first) => {
      const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
        input: {
          first,
        },
      }).expect(200);

      expect(response.body.data).toBeNull();
      expect(response.body.errors?.[0]?.message).toBe('Bad Request Exception');
    },
  );

  it('supports correlationId and date-range filters together', async () => {
    const beforeResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: 'food.dietary_restrictions',
      },
    }).expect(200);
    expect(beforeResponse.body.errors).toBeUndefined();

    await graphqlRequest(APPLY_SUGGESTIONS_MUTATION, {
      analysisId: 'analysis-2',
      input: [
        {
          suggestionId: 'suggestion-2',
          slug: 'food.dietary_restrictions',
          operation: 'CREATE',
          newValue: ['gluten'],
        },
      ],
    }).expect(200);

    const auditRow = await prisma.preferenceAuditEvent.findFirst({
      where: {
        userId: testUser.userId,
        correlationId: 'analysis-2',
      },
      orderBy: { occurredAt: 'desc' },
    });

    expect(auditRow).toBeTruthy();

    const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        correlationId: 'analysis-2',
        occurredFrom: new Date(
          auditRow!.occurredAt.getTime() - 1000,
        ).toISOString(),
        occurredTo: new Date(
          auditRow!.occurredAt.getTime() + 1000,
        ).toISOString(),
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.preferenceAuditHistory.items).toHaveLength(1);
    expect(response.body.data.preferenceAuditHistory.items[0]).toMatchObject({
      correlationId: 'analysis-2',
      origin: AuditOrigin.DOCUMENT_ANALYSIS,
      subjectSlug: 'food.dietary_restrictions',
    });
  });

  it('returns raw snapshot payloads and metadata for lifecycle events', async () => {
    const slug = 'custom.audit_payloads';
    const definitionId = await createDefinition(slug);

    const setResponse = await graphqlRequest(SET_PREFERENCE_MUTATION, {
      input: {
        slug,
        value: 'initial',
      },
    }).expect(200);
    expect(setResponse.body.errors).toBeUndefined();
    const activePreferenceId = setResponse.body.data.setPreference.id as string;

    const suggestionResponse = await graphqlRequest(
      SUGGEST_PREFERENCE_MUTATION,
      {
        input: {
          slug,
          value: 'accepted',
          confidence: 0.9,
        },
      },
    ).expect(200);
    expect(suggestionResponse.body.errors).toBeUndefined();
    const acceptedSuggestionId = suggestionResponse.body.data.suggestPreference
      .id as string;

    await graphqlRequest(ACCEPT_SUGGESTION_MUTATION, {
      id: acceptedSuggestionId,
    }).expect(200);

    await graphqlRequest(DELETE_PREFERENCE_MUTATION, {
      id: activePreferenceId,
    }).expect(200);

    const response = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: slug,
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const items = response.body.data.preferenceAuditHistory.items as any[];

    const definitionCreatedEvent = items.find(
      (item) => item.eventType === 'DEFINITION_CREATED',
    );
    const acceptedEvent = items.find(
      (item) => item.eventType === 'PREFERENCE_SUGGESTION_ACCEPTED',
    );
    const deletedEvent = items.find(
      (item) => item.eventType === 'PREFERENCE_DELETED',
    );

    expect(definitionCreatedEvent).toMatchObject({
      subjectSlug: slug,
      targetType: 'PREFERENCE_DEFINITION',
      targetId: definitionId,
      beforeState: null,
      afterState: expect.objectContaining({
        slug,
      }),
    });
    expect(acceptedEvent).toMatchObject({
      subjectSlug: slug,
      targetType: 'PREFERENCE',
      metadata: {
        consumedSuggestion: expect.objectContaining({
          slug,
          status: 'SUGGESTED',
          value: 'accepted',
        }),
      },
    });
    expect(deletedEvent).toMatchObject({
      subjectSlug: slug,
      targetType: 'PREFERENCE',
      afterState: null,
      beforeState: expect.objectContaining({
        slug,
      }),
    });
  });

  it('keeps subjectSlug pagination stable when other slugs are interleaved in the global timeline', async () => {
    await seedAuditEvent({
      id: 'audit-target-1',
      subjectSlug: 'food.dietary_restrictions',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-target-1',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T10:00:00.000Z'),
    });
    await seedAuditEvent({
      id: 'audit-other-1',
      subjectSlug: 'system.response_tone',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-other-1',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T10:30:00.000Z'),
    });
    await seedAuditEvent({
      id: 'audit-target-2',
      subjectSlug: 'food.dietary_restrictions',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-target-2',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T11:00:00.000Z'),
    });
    await seedAuditEvent({
      id: 'audit-other-2',
      subjectSlug: 'system.response_tone',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-other-2',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T11:30:00.000Z'),
    });
    await seedAuditEvent({
      id: 'audit-target-3',
      subjectSlug: 'food.dietary_restrictions',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-target-3',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T12:00:00.000Z'),
    });

    const firstPageResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: 'food.dietary_restrictions',
        first: 2,
      },
    }).expect(200);

    expect(firstPageResponse.body.errors).toBeUndefined();
    const firstPage = firstPageResponse.body.data.preferenceAuditHistory;
    expect(firstPage.items.map((item: any) => item.id)).toEqual([
      'audit-target-3',
      'audit-target-2',
    ]);
    expect(
      firstPage.items.every(
        (item: any) => item.subjectSlug === 'food.dietary_restrictions',
      ),
    ).toBe(true);
    expect(firstPage.hasNextPage).toBe(true);

    const secondPageResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: 'food.dietary_restrictions',
        first: 2,
        after: firstPage.nextCursor,
      },
    }).expect(200);

    expect(secondPageResponse.body.errors).toBeUndefined();
    const secondPage = secondPageResponse.body.data.preferenceAuditHistory;
    expect(secondPage.items.map((item: any) => item.id)).toEqual([
      'audit-target-1',
    ]);
    expect(
      secondPage.items.every(
        (item: any) => item.subjectSlug === 'food.dietary_restrictions',
      ),
    ).toBe(true);
    expect(secondPage.hasNextPage).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('scopes audit history to the authenticated user at the GraphQL resolver layer', async () => {
    const secondaryUser = await prisma.user.create({
      data: {
        email: 'audit-history-secondary@example.com',
      },
    });

    await seedAuditEvent({
      id: 'audit-primary-user',
      subjectSlug: 'food.dietary_restrictions',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-primary-user',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T10:00:00.000Z'),
    });
    await seedAuditEvent({
      id: 'audit-secondary-user',
      userId: secondaryUser.userId,
      subjectSlug: 'food.dietary_restrictions',
      targetType: AuditTargetType.PREFERENCE,
      targetId: 'pref-secondary-user',
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date('2026-04-18T11:00:00.000Z'),
    });

    const primaryResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: 'food.dietary_restrictions',
      },
    }).expect(200);

    expect(primaryResponse.body.errors).toBeUndefined();
    expect(
      primaryResponse.body.data.preferenceAuditHistory.items.map(
        (item: any) => item.id,
      ),
    ).toEqual(['audit-primary-user']);

    setTestUser(secondaryUser);

    const secondaryResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: {
        subjectSlug: 'food.dietary_restrictions',
      },
    }).expect(200);

    expect(secondaryResponse.body.errors).toBeUndefined();
    expect(
      secondaryResponse.body.data.preferenceAuditHistory.items.map(
        (item: any) => item.id,
      ),
    ).toEqual(['audit-secondary-user']);
  });
});
