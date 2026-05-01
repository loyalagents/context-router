import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
  GrantAction,
  GrantEffect,
  McpAccessOutcome,
  McpAccessSurface,
  PreferenceScope,
  PreferenceStatus,
  PreferenceValueType,
  SourceType,
} from '../../src/infrastructure/prisma/generated-client';

describe('Demo Memory Reset GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  const prisma = getPrismaClient();
  const originalEnableDemoReset = process.env.ENABLE_DEMO_RESET;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
  });

  beforeEach(async () => {
    process.env.ENABLE_DEMO_RESET = 'false';
    testUser = await createTestUser();
    setTestUser(testUser);
  });

  afterAll(async () => {
    if (originalEnableDemoReset === undefined) {
      delete process.env.ENABLE_DEMO_RESET;
    } else {
      process.env.ENABLE_DEMO_RESET = originalEnableDemoReset;
    }
    await app.close();
  });

  const RESET_MUTATION = `
    mutation ResetMyMemory($mode: ResetMemoryMode!) {
      resetMyMemory(mode: $mode) {
        mode
        preferencesDeleted
        preferenceDefinitionsDeleted
        locationsDeleted
        preferenceAuditEventsDeleted
        mcpAccessEventsDeleted
        permissionGrantsDeleted
      }
    }
  `;

  const AUDIT_HISTORY_QUERY = `
    query PreferenceAuditHistory($input: PreferenceAuditHistoryInput!) {
      preferenceAuditHistory(input: $input) {
        items {
          eventType
          subjectSlug
          targetType
          targetId
          metadata
        }
      }
    }
  `;

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  async function createUser(email: string): Promise<TestUser> {
    return prisma.user.create({
      data: {
        email,
        firstName: 'Reset',
        lastName: 'Other',
      },
    });
  }

  async function seedResetData(user: TestUser, slugSuffix: string) {
    const [foodDefinition, toneDefinition] = await Promise.all([
      prisma.preferenceDefinition.findFirstOrThrow({
        where: { namespace: 'GLOBAL', slug: 'food.dietary_restrictions' },
      }),
      prisma.preferenceDefinition.findFirstOrThrow({
        where: { namespace: 'GLOBAL', slug: 'system.response_tone' },
      }),
    ]);

    const location = await prisma.location.create({
      data: {
        userId: user.userId,
        type: 'HOME',
        label: `Reset ${slugSuffix}`,
        address: '123 Reset St',
      },
    });

    const userDefinition = await prisma.preferenceDefinition.create({
      data: {
        namespace: `USER:${user.userId}`,
        ownerUserId: user.userId,
        slug: `custom.${slugSuffix}`,
        displayName: `Custom ${slugSuffix}`,
        description: 'User-owned reset test definition',
        valueType: PreferenceValueType.STRING,
        scope: PreferenceScope.LOCATION,
        isSensitive: false,
        isCore: false,
      },
    });

    const activePreference = await prisma.preference.create({
      data: {
        userId: user.userId,
        definitionId: foodDefinition.id,
        contextKey: 'GLOBAL',
        value: ['nuts'],
        status: PreferenceStatus.ACTIVE,
        sourceType: SourceType.USER,
      },
    });

    await prisma.preference.create({
      data: {
        userId: user.userId,
        definitionId: toneDefinition.id,
        contextKey: 'GLOBAL',
        value: 'casual',
        status: PreferenceStatus.SUGGESTED,
        sourceType: SourceType.INFERRED,
        confidence: 0.8,
      },
    });

    await prisma.preference.create({
      data: {
        userId: user.userId,
        locationId: location.locationId,
        contextKey: `LOCATION:${location.locationId}`,
        definitionId: userDefinition.id,
        value: 'old value',
        status: PreferenceStatus.REJECTED,
        sourceType: SourceType.USER,
      },
    });

    await prisma.preferenceAuditEvent.create({
      data: {
        userId: user.userId,
        subjectSlug: foodDefinition.slug,
        targetType: AuditTargetType.PREFERENCE,
        targetId: activePreference.id,
        eventType: AuditEventType.PREFERENCE_SET,
        actorType: AuditActorType.USER,
        origin: AuditOrigin.GRAPHQL,
        correlationId: `reset-${slugSuffix}`,
        beforeState: null,
        afterState: { id: activePreference.id },
      },
    });

    await prisma.mcpAccessEvent.create({
      data: {
        userId: user.userId,
        clientKey: 'claude',
        surface: McpAccessSurface.TOOLS_CALL,
        operationName: 'searchPreferences',
        outcome: McpAccessOutcome.SUCCESS,
        correlationId: `mcp-reset-${slugSuffix}`,
        latencyMs: 5,
      },
    });

    await prisma.permissionGrant.create({
      data: {
        userId: user.userId,
        clientKey: 'claude',
        target: 'food.*',
        action: GrantAction.READ,
        effect: GrantEffect.DENY,
      },
    });

    return { userDefinition };
  }

  async function countsFor(user: TestUser) {
    const userDefinitionWhere = {
      namespace: `USER:${user.userId}`,
      ownerUserId: user.userId,
    };

    const [
      preferences,
      locations,
      preferenceDefinitions,
      preferenceAuditEvents,
      mcpAccessEvents,
      permissionGrants,
      users,
      externalIdentities,
    ] = await Promise.all([
      prisma.preference.count({ where: { userId: user.userId } }),
      prisma.location.count({ where: { userId: user.userId } }),
      prisma.preferenceDefinition.count({ where: userDefinitionWhere }),
      prisma.preferenceAuditEvent.count({ where: { userId: user.userId } }),
      prisma.mcpAccessEvent.count({ where: { userId: user.userId } }),
      prisma.permissionGrant.count({ where: { userId: user.userId } }),
      prisma.user.count({ where: { userId: user.userId } }),
      prisma.externalIdentity.count({ where: { userId: user.userId } }),
    ]);

    return {
      preferences,
      locations,
      preferenceDefinitions,
      preferenceAuditEvents,
      mcpAccessEvents,
      permissionGrants,
      users,
      externalIdentities,
    };
  }

  it('MEMORY_ONLY deletes only current user preference rows', async () => {
    await seedResetData(testUser, 'current_memory');
    const otherUser = await createUser('reset-other-memory@example.com');
    await seedResetData(otherUser, 'other_memory');

    const response = await graphqlRequest(RESET_MUTATION, {
      mode: 'MEMORY_ONLY',
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.resetMyMemory).toEqual({
      mode: 'MEMORY_ONLY',
      preferencesDeleted: 3,
      preferenceDefinitionsDeleted: 0,
      locationsDeleted: 0,
      preferenceAuditEventsDeleted: 0,
      mcpAccessEventsDeleted: 0,
      permissionGrantsDeleted: 0,
    });

    await expect(countsFor(testUser)).resolves.toMatchObject({
      preferences: 0,
      locations: 1,
      preferenceDefinitions: 1,
      preferenceAuditEvents: 2,
      mcpAccessEvents: 1,
      permissionGrants: 1,
      users: 1,
    });
    const resetAuditEvent = await prisma.preferenceAuditEvent.findFirst({
      where: {
        userId: testUser.userId,
        eventType: AuditEventType.PREFERENCES_RESET,
      },
    });
    expect(resetAuditEvent).toMatchObject({
      subjectSlug: '*',
      targetType: AuditTargetType.PREFERENCE,
      targetId: testUser.userId,
      actorType: AuditActorType.USER,
      origin: AuditOrigin.GRAPHQL,
      beforeState: null,
      afterState: null,
      metadata: {
        mode: 'MEMORY_ONLY',
        preferencesDeleted: 3,
      },
    });
    const auditHistoryResponse = await graphqlRequest(AUDIT_HISTORY_QUERY, {
      input: { eventType: 'PREFERENCES_RESET' },
    }).expect(200);
    expect(auditHistoryResponse.body.errors).toBeUndefined();
    expect(
      auditHistoryResponse.body.data.preferenceAuditHistory.items,
    ).toContainEqual(
      expect.objectContaining({
        eventType: 'PREFERENCES_RESET',
        subjectSlug: '*',
        targetType: 'PREFERENCE',
        targetId: testUser.userId,
        metadata: {
          mode: 'MEMORY_ONLY',
          preferencesDeleted: 3,
        },
      }),
    );
    await expect(countsFor(otherUser)).resolves.toMatchObject({
      preferences: 3,
      locations: 1,
      preferenceDefinitions: 1,
      preferenceAuditEvents: 1,
      mcpAccessEvents: 1,
      permissionGrants: 1,
      users: 1,
    });
  });

  it('rejects advanced reset modes when demo reset is disabled', async () => {
    await seedResetData(testUser, 'disabled_demo');

    for (const mode of ['DEMO_DATA', 'FULL_USER_DATA']) {
      const response = await graphqlRequest(RESET_MUTATION, {
        mode,
      }).expect(200);

      expect(response.body.data).toBeNull();
      expect(response.body.errors?.[0]?.message).toContain(
        'Demo reset modes are disabled',
      );
      await expect(countsFor(testUser)).resolves.toMatchObject({
        preferences: 3,
        locations: 1,
        preferenceDefinitions: 1,
        preferenceAuditEvents: 1,
        mcpAccessEvents: 1,
        permissionGrants: 1,
        users: 1,
      });
    }
  });

  it('DEMO_DATA deletes current user demo data but preserves permission grants and other users', async () => {
    process.env.ENABLE_DEMO_RESET = 'true';
    await seedResetData(testUser, 'current_demo');
    const otherUser = await createUser('reset-other-demo@example.com');
    await seedResetData(otherUser, 'other_demo');

    const response = await graphqlRequest(RESET_MUTATION, {
      mode: 'DEMO_DATA',
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.resetMyMemory).toEqual({
      mode: 'DEMO_DATA',
      preferencesDeleted: 3,
      preferenceDefinitionsDeleted: 1,
      locationsDeleted: 1,
      preferenceAuditEventsDeleted: 1,
      mcpAccessEventsDeleted: 1,
      permissionGrantsDeleted: 0,
    });

    await expect(countsFor(testUser)).resolves.toMatchObject({
      preferences: 0,
      locations: 0,
      preferenceDefinitions: 0,
      preferenceAuditEvents: 0,
      mcpAccessEvents: 0,
      permissionGrants: 1,
      users: 1,
    });
    await expect(countsFor(otherUser)).resolves.toMatchObject({
      preferences: 3,
      locations: 1,
      preferenceDefinitions: 1,
      preferenceAuditEvents: 1,
      mcpAccessEvents: 1,
      permissionGrants: 1,
      users: 1,
    });
  });

  it('FULL_USER_DATA also deletes current user permission grants', async () => {
    process.env.ENABLE_DEMO_RESET = 'true';
    await seedResetData(testUser, 'full_demo');
    const otherUser = await createUser('reset-other-full-demo@example.com');
    await seedResetData(otherUser, 'other_full_demo');

    const response = await graphqlRequest(RESET_MUTATION, {
      mode: 'FULL_USER_DATA',
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.resetMyMemory).toEqual({
      mode: 'FULL_USER_DATA',
      preferencesDeleted: 3,
      preferenceDefinitionsDeleted: 1,
      locationsDeleted: 1,
      preferenceAuditEventsDeleted: 1,
      mcpAccessEventsDeleted: 1,
      permissionGrantsDeleted: 1,
    });

    await expect(countsFor(testUser)).resolves.toMatchObject({
      preferences: 0,
      locations: 0,
      preferenceDefinitions: 0,
      preferenceAuditEvents: 0,
      mcpAccessEvents: 0,
      permissionGrants: 0,
      users: 1,
    });
    await expect(countsFor(otherUser)).resolves.toMatchObject({
      preferences: 3,
      locations: 1,
      preferenceDefinitions: 1,
      preferenceAuditEvents: 1,
      mcpAccessEvents: 1,
      permissionGrants: 1,
      users: 1,
    });
  });

  it.each(['DEMO_DATA', 'FULL_USER_DATA'] as const)(
    '%s preserves the current user and external identity rows',
    async (mode) => {
      process.env.ENABLE_DEMO_RESET = 'true';
      await seedResetData(testUser, `identity_${mode.toLowerCase()}`);
      await prisma.externalIdentity.create({
        data: {
          userId: testUser.userId,
          provider: 'auth0',
          providerUserId: `auth0|${mode.toLowerCase()}-reset-user`,
          metadata: { source: 'reset-test' },
        },
      });

      const response = await graphqlRequest(RESET_MUTATION, {
        mode,
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      await expect(countsFor(testUser)).resolves.toMatchObject({
        users: 1,
        externalIdentities: 1,
      });
    },
  );

  it('MEMORY_ONLY preserves the current user and external identity rows', async () => {
    await seedResetData(testUser, 'identity_memory_only');
    await prisma.externalIdentity.create({
      data: {
        userId: testUser.userId,
        provider: 'auth0',
        providerUserId: 'auth0|memory-only-reset-user',
        metadata: { source: 'reset-test' },
      },
    });

    const response = await graphqlRequest(RESET_MUTATION, {
      mode: 'MEMORY_ONLY',
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    await expect(countsFor(testUser)).resolves.toMatchObject({
      users: 1,
      externalIdentities: 1,
    });
  });

  it('rolls back when another user references a current user definition', async () => {
    process.env.ENABLE_DEMO_RESET = 'true';
    const { userDefinition } = await seedResetData(testUser, 'cross_user');
    const otherUser = await createUser('reset-other-cross-user@example.com');

    await prisma.preference.create({
      data: {
        userId: otherUser.userId,
        definitionId: userDefinition.id,
        contextKey: 'GLOBAL',
        value: 'cross user value',
        status: PreferenceStatus.ACTIVE,
        sourceType: SourceType.USER,
      },
    });

    const response = await graphqlRequest(RESET_MUTATION, {
      mode: 'DEMO_DATA',
    }).expect(200);

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toContain(
      'referenced by another user',
    );

    await expect(countsFor(testUser)).resolves.toMatchObject({
      preferences: 3,
      locations: 1,
      preferenceDefinitions: 1,
      preferenceAuditEvents: 1,
      mcpAccessEvents: 1,
      permissionGrants: 1,
      users: 1,
    });
    await expect(countsFor(otherUser)).resolves.toMatchObject({
      preferences: 1,
      users: 1,
    });
  });
});
