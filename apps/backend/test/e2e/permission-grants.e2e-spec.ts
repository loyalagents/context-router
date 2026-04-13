import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ApiKeyMcpClientKey } from '../../src/infrastructure/prisma/generated-client';
import { PermissionGrantRepository } from '../../src/modules/permission-grant/permission-grant.repository';
import { PreferenceService } from '../../src/modules/preferences/preference/preference.service';
import { PreferenceDefinitionService } from '../../src/modules/preferences/preference-definition/preference-definition.service';

const TEST_CLIENT_KEYS = {
  claude: 'claude',
  codex: 'codex',
} as const;

describe('Permission Grants (e2e)', () => {
  let app: INestApplication;
  let realAuthApp: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let registerMcpUser: (user: TestUser) => void;
  let grantRepository: PermissionGrantRepository;
  let preferenceService: PreferenceService;
  let preferenceDefinitionService: PreferenceDefinitionService;
  let realApiKey: string;
  let structuredAi: {
    generateStructured: jest.Mock;
    generateStructuredWithFile: jest.Mock;
  };

  beforeAll(async () => {
    structuredAi = {
      generateStructured: jest.fn(),
      generateStructuredWithFile: jest.fn(),
    };

    const testApp = await createTestApp({
      mockStructuredAi: structuredAi,
    });

    app = testApp.app;
    setTestUser = testApp.setTestUser;
    registerMcpUser = testApp.registerMcpUser;

    const realAuthTestApp = await createTestApp({
      mockStructuredAi: structuredAi,
      mockAuthGuards: false,
    });
    realAuthApp = realAuthTestApp.app;

    const prisma = getPrismaClient() as unknown as PrismaService;
    grantRepository = new PermissionGrantRepository(prisma);
    preferenceService = testApp.module.get(PreferenceService);
    preferenceDefinitionService = testApp.module.get(PreferenceDefinitionService);
  });

  beforeEach(async () => {
    structuredAi.generateStructured.mockReset();
    structuredAi.generateStructuredWithFile.mockReset();

    testUser = await createTestUser();
    setTestUser(testUser);
    registerMcpUser(testUser);
    realApiKey = await createApiKeyForUser(
      ApiKeyMcpClientKey.CLAUDE,
      testUser.userId,
      `perm-grants-${testUser.userId}`,
    );
  });

  afterAll(async () => {
    await app.close();
    await realAuthApp.close();
  });

  const mcpHeaders = (
    clientKey: string,
    extra: Record<string, string> = {},
    userId = testUser.userId,
  ) => ({
    'x-test-mcp-client-id': clientKey,
    'x-test-user-id': userId,
    ...extra,
  });

  const mcpToolCall = async (
    name: string,
    args: Record<string, unknown>,
    clientKey: string = TEST_CLIENT_KEYS.claude,
    userId = testUser.userId,
  ) => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(mcpHeaders(clientKey, {}, userId))
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });

    expect(response.status).toBe(200);
    return response.body.result;
  };

  const graphQlPost = async (
    query: string,
    variables?: Record<string, unknown>,
    apiKey = realApiKey,
    userId = testUser.userId,
  ) =>
    request(realAuthApp.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('x-user-id', userId)
      .send({ query, variables });

  const createApiKeyForUser = async (
    mcpClientKey: ApiKeyMcpClientKey,
    userId: string,
    plaintextKey: string,
  ) => {
    const prisma = getPrismaClient();
    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        keyHash: createHash('sha256').update(plaintextKey).digest('hex'),
        groupName: `Permission Grants ${mcpClientKey} Group`,
        mcpClientKey,
      },
    });

    await prisma.apiKeyUser.create({
      data: {
        apiKeyId: apiKeyRecord.id,
        userId,
      },
    });

    return plaintextKey;
  };

  const parseToolResult = (result: any) =>
    JSON.parse(result.content[0].text);

  it('denies suggestPreference for matching denied write grants and allows unmatched slugs', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'WRITE',
      'DENY',
    );

    const denied = await mcpToolCall('suggestPreference', {
      slug: 'food.dietary_restrictions',
      value: '["nuts"]',
      confidence: 0.9,
    });

    expect(denied.isError).toBe(true);
    expect(parseToolResult(denied).error).toContain('not allowed to write preferences');

    const allowed = await mcpToolCall('suggestPreference', {
      slug: 'system.response_tone',
      value: '"concise"',
      confidence: 0.9,
    });

    expect(allowed.isError).not.toBe(true);
    expect(parseToolResult(allowed).success).toBe(true);
  });

  it('denies deletePreference when the preference slug matches a denied write grant', async () => {
    const preference = await preferenceService.setPreference(testUser.userId, {
      slug: 'food.dietary_restrictions',
      value: ['nuts'],
    });

    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'WRITE',
      'DENY',
    );

    const denied = await mcpToolCall('deletePreference', {
      id: preference.id,
    });

    expect(denied.isError).toBe(true);
    expect(parseToolResult(denied).error).toContain('not allowed to write preferences');
  });

  it('does not let read denies block writes for the same slug', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const allowed = await mcpToolCall('suggestPreference', {
      slug: 'food.dietary_restrictions',
      value: '["nuts"]',
      confidence: 0.9,
    });

    expect(allowed.isError).not.toBe(true);
    expect(parseToolResult(allowed).success).toBe(true);
  });

  it('does not let write denies block reads for the same slug', async () => {
    await preferenceService.setPreference(testUser.userId, {
      slug: 'food.dietary_restrictions',
      value: ['nuts'],
    });

    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'WRITE',
      'DENY',
    );

    const search = parseToolResult(
      await mcpToolCall('searchPreferences', {
        includeSuggestions: false,
      }),
    );
    expect(search.active.preferences.map((pref: any) => pref.slug)).toContain(
      'food.dietary_restrictions',
    );

    const list = parseToolResult(
      await mcpToolCall('listPreferenceSlugs', {}),
    );
    expect(list.preferences.map((pref: any) => pref.slug)).toContain(
      'food.dietary_restrictions',
    );
  });

  it('filters denied slugs out of searchPreferences and listPreferenceSlugs responses', async () => {
    await preferenceService.setPreference(testUser.userId, {
      slug: 'food.dietary_restrictions',
      value: ['nuts'],
    });
    await preferenceService.setPreference(testUser.userId, {
      slug: 'system.response_tone',
      value: 'concise',
    });

    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const search = parseToolResult(
      await mcpToolCall('searchPreferences', {
        includeSuggestions: false,
      }),
    );
    expect(search.active.preferences.map((pref: any) => pref.slug)).toEqual([
      'system.response_tone',
    ]);

    const list = parseToolResult(
      await mcpToolCall('listPreferenceSlugs', {}),
    );
    expect(list.preferences.some((pref: any) => pref.slug.startsWith('food.'))).toBe(false);
    expect(list.categories).not.toContain('food');
  });

  it('filters denied slugs before smartSearchPreferences builds the AI prompt', async () => {
    await preferenceService.setPreference(testUser.userId, {
      slug: 'food.dietary_restrictions',
      value: ['nuts'],
    });
    await preferenceService.setPreference(testUser.userId, {
      slug: 'system.response_tone',
      value: 'concise',
    });

    structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.dietary_restrictions', 'system.response_tone'],
      queryInterpretation: 'tone preferences',
    });

    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const result = parseToolResult(
      await mcpToolCall('smartSearchPreferences', {
        query: 'What tone should I use?',
      }),
    );

    expect(result.matchedDefinitions.map((def: any) => def.slug)).toEqual([
      'system.response_tone',
    ]);
    expect(
      result.matchedActivePreferences.map((pref: any) => pref.slug),
    ).toEqual(['system.response_tone']);

    const prompt = structuredAi.generateStructured.mock.calls[0][0] as string;
    expect(prompt).toContain('system.response_tone');
    expect(prompt).not.toContain('food.dietary_restrictions');
  });

  it('returns empty read results across tools when deny * read is set', async () => {
    await preferenceService.setPreference(testUser.userId, {
      slug: 'food.dietary_restrictions',
      value: ['nuts'],
    });
    await preferenceService.setPreference(testUser.userId, {
      slug: 'system.response_tone',
      value: 'concise',
    });

    structuredAi.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.dietary_restrictions', 'system.response_tone'],
      queryInterpretation: 'all preferences',
      consolidationGroups: [],
      summary: 'No overlaps found',
    });

    await grantRepository.upsert(testUser.userId, 'claude', '*', 'READ', 'DENY');

    const search = parseToolResult(
      await mcpToolCall('searchPreferences', { includeSuggestions: false }),
    );
    expect(search.active.preferences).toEqual([]);

    const list = parseToolResult(await mcpToolCall('listPreferenceSlugs', {}));
    expect(list.preferences).toEqual([]);
    expect(list.categories).toEqual([]);

    const smartSearch = parseToolResult(
      await mcpToolCall('smartSearchPreferences', {
        query: 'Show me all of my preferences',
      }),
    );
    expect(smartSearch.matchedDefinitions).toEqual([]);
    expect(smartSearch.matchedActivePreferences).toEqual([]);
    expect(smartSearch.matchedSuggestedPreferences).toEqual([]);

    const smartSearchPrompt = structuredAi.generateStructured.mock.calls[0][0] as string;
    expect(smartSearchPrompt).not.toContain('food.dietary_restrictions');
    expect(smartSearchPrompt).not.toContain('system.response_tone');

    structuredAi.generateStructured.mockReset();
    structuredAi.generateStructured.mockResolvedValue({
      consolidationGroups: [],
      summary: 'No overlaps found',
    });

    const consolidation = parseToolResult(
      await mcpToolCall('consolidateSchema', { scope: 'ALL' }),
    );
    expect(consolidation.totalDefinitionsAnalyzed).toBe(0);
    expect(consolidation.consolidationGroups).toEqual([]);
    expect(consolidation.summary).toContain('No definitions');
    expect(structuredAi.generateStructured).not.toHaveBeenCalled();
  });

  it('supports sub-category wildcard denies without hiding sibling categories', async () => {
    await preferenceDefinitionService.create(
      {
        slug: 'food.french.wine',
        description: 'French wine preference',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isSensitive: false,
        isCore: false,
      },
      testUser.userId,
    );
    await preferenceDefinitionService.create(
      {
        slug: 'food.italian.pasta',
        description: 'Italian pasta preference',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isSensitive: false,
        isCore: false,
      },
      testUser.userId,
    );
    await preferenceService.setPreference(testUser.userId, {
      slug: 'food.french.wine',
      value: 'red',
    });
    await preferenceService.setPreference(testUser.userId, {
      slug: 'food.italian.pasta',
      value: 'rigatoni',
    });

    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.french.*',
      'READ',
      'DENY',
    );

    const list = parseToolResult(await mcpToolCall('listPreferenceSlugs', {}));
    expect(list.preferences.map((pref: any) => pref.slug)).not.toContain(
      'food.french.wine',
    );
    expect(list.preferences.map((pref: any) => pref.slug)).toContain(
      'food.italian.pasta',
    );

    const search = parseToolResult(
      await mcpToolCall('searchPreferences', { includeSuggestions: false }),
    );
    expect(search.active.preferences.map((pref: any) => pref.slug)).not.toContain(
      'food.french.wine',
    );
    expect(search.active.preferences.map((pref: any) => pref.slug)).toContain(
      'food.italian.pasta',
    );
  });

  it('keeps client-specific read grants isolated to the matching client bucket', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const claudeList = parseToolResult(
      await mcpToolCall('listPreferenceSlugs', {}, TEST_CLIENT_KEYS.claude),
    );
    expect(
      claudeList.preferences.some((pref: any) => pref.slug.startsWith('food.')),
    ).toBe(false);

    const codexList = parseToolResult(
      await mcpToolCall('listPreferenceSlugs', {}, TEST_CLIENT_KEYS.codex),
    );
    expect(
      codexList.preferences.some((pref: any) => pref.slug.startsWith('food.')),
    ).toBe(true);
  });

  it('keeps grants isolated per user', async () => {
    const prisma = getPrismaClient();
    const otherUser = await prisma.user.create({
      data: {
        email: 'other-permission-user@example.com',
        firstName: 'Other',
        lastName: 'User',
      },
    });
    registerMcpUser(otherUser);

    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const firstUserList = parseToolResult(
      await mcpToolCall('listPreferenceSlugs', {}, TEST_CLIENT_KEYS.claude, testUser.userId),
    );
    expect(
      firstUserList.preferences.some((pref: any) => pref.slug.startsWith('food.')),
    ).toBe(false);

    const secondUserList = parseToolResult(
      await mcpToolCall(
        'listPreferenceSlugs',
        {},
        TEST_CLIENT_KEYS.claude,
        otherUser.userId,
      ),
    );
    expect(
      secondUserList.preferences.some((pref: any) => pref.slug.startsWith('food.')),
    ).toBe(true);
  });

  it('supports allowlist-style read access with deny * plus allow food.*', async () => {
    await preferenceService.setPreference(testUser.userId, {
      slug: 'food.dietary_restrictions',
      value: ['nuts'],
    });
    await preferenceService.setPreference(testUser.userId, {
      slug: 'system.response_tone',
      value: 'concise',
    });

    await grantRepository.upsert(testUser.userId, 'claude', '*', 'READ', 'DENY');
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'ALLOW',
    );

    const list = parseToolResult(await mcpToolCall('listPreferenceSlugs', {}));
    expect(list.preferences.every((pref: any) => pref.slug.startsWith('food.'))).toBe(
      true,
    );
    expect(list.categories).toEqual(['food']);

    const search = parseToolResult(
      await mcpToolCall('searchPreferences', { includeSuggestions: false }),
    );
    expect(search.active.preferences.map((pref: any) => pref.slug)).toEqual([
      'food.dietary_restrictions',
    ]);
  });

  it('keeps a short exact-slug allow exception when a category wildcard is denied', async () => {
    await preferenceDefinitionService.create(
      {
        slug: 'a.b',
        description: 'Allowed short slug',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isSensitive: false,
        isCore: false,
      },
      testUser.userId,
    );
    await preferenceDefinitionService.create(
      {
        slug: 'a.c',
        description: 'Denied short slug',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isSensitive: false,
        isCore: false,
      },
      testUser.userId,
    );

    await grantRepository.upsert(testUser.userId, 'claude', 'a.*', 'READ', 'DENY');
    await grantRepository.upsert(testUser.userId, 'claude', 'a.b', 'READ', 'ALLOW');

    const result = parseToolResult(await mcpToolCall('listPreferenceSlugs', {}));

    expect(result.preferences.map((pref: any) => pref.slug)).toContain('a.b');
    expect(result.preferences.map((pref: any) => pref.slug)).not.toContain('a.c');
  });

  it('filters denied slugs before consolidateSchema builds the AI prompt', async () => {
    await preferenceDefinitionService.create(
      {
        slug: 'system.custom_tone_one',
        description: 'System tone one',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isSensitive: false,
        isCore: false,
      },
      testUser.userId,
    );
    await preferenceDefinitionService.create(
      {
        slug: 'system.custom_tone_two',
        description: 'System tone two',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isSensitive: false,
        isCore: false,
      },
      testUser.userId,
    );
    await preferenceDefinitionService.create(
      {
        slug: 'food.secret_sauce',
        description: 'Secret sauce',
        valueType: 'STRING',
        scope: 'GLOBAL',
        isSensitive: false,
        isCore: false,
      },
      testUser.userId,
    );

    structuredAi.generateStructured.mockResolvedValue({
      consolidationGroups: [
        {
          slugs: ['food.secret_sauce', 'system.custom_tone_one'],
          reason: 'overlap',
          suggestion: 'REVIEW',
        },
      ],
      summary: 'Review possible duplicates.',
    });

    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const result = parseToolResult(
      await mcpToolCall('consolidateSchema', {
        scope: 'PERSONAL',
      }),
    );

    expect(result.consolidationGroups).toEqual([]);

    const prompt = structuredAi.generateStructured.mock.calls[0][0] as string;
    expect(prompt).toContain('system.custom_tone_one');
    expect(prompt).not.toContain('food.secret_sauce');
  });

  it('does not let DB write allows widen codex past the coarse read-only policy', async () => {
    await grantRepository.upsert(testUser.userId, 'codex', '*', 'WRITE', 'ALLOW');

    const denied = await mcpToolCall(
      'suggestPreference',
      {
        slug: 'system.response_tone',
        value: '"concise"',
        confidence: 0.9,
      },
      TEST_CLIENT_KEYS.codex,
    );

    expect(denied.isError).toBe(true);
    expect(parseToolResult(denied).error).toContain('not allowed to write preferences');
  });

  it('denies applyPreference when the slug matches a denied write grant', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'WRITE',
      'DENY',
    );

    const denied = await mcpToolCall(
      'applyPreference',
      {
        slug: 'food.dietary_restrictions',
        value: '["shellfish"]',
        confidence: 0.9,
      },
      TEST_CLIENT_KEYS.claude,
    );

    expect(denied.isError).toBe(true);
    expect(parseToolResult(denied).error).toContain('not allowed to write preferences');
  });

  it('denies createPreferenceDefinition when the slug matches a denied write grant', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'WRITE',
      'DENY',
    );

    const denied = await mcpToolCall('createPreferenceDefinition', {
      slug: 'food.secret_menu_note',
      description: 'Secret menu note',
      valueType: 'STRING',
      scope: 'GLOBAL',
    });

    expect(denied.isError).toBe(true);
    expect(parseToolResult(denied).error).toContain('not allowed to write preferences');
  });

  it('scopes listPermissionGrants to the calling client key', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );
    await grantRepository.upsert(
      testUser.userId,
      'codex',
      'system.*',
      'READ',
      'ALLOW',
    );

    const claudeResult = parseToolResult(
      await mcpToolCall('listPermissionGrants', {}, TEST_CLIENT_KEYS.claude),
    );
    expect(claudeResult.grants).toHaveLength(1);
    expect(claudeResult.grants[0].clientKey).toBe('claude');

    const codexResult = parseToolResult(
      await mcpToolCall('listPermissionGrants', {}, TEST_CLIENT_KEYS.codex),
    );
    expect(codexResult.grants).toHaveLength(1);
    expect(codexResult.grants[0].clientKey).toBe('codex');
  });

  it('supports GraphQL grant CRUD for the authenticated user', async () => {
    const setMutation = await graphQlPost(`
      mutation SetGrant($input: SetPermissionGrantInput!) {
        setPermissionGrant(input: $input) {
          clientKey
          target
          action
          effect
        }
      }
    `, {
      input: {
        clientKey: 'claude',
        target: 'food.*',
        action: 'READ',
        effect: 'DENY',
      },
    });

    expect(setMutation.body.errors).toBeUndefined();
    expect(setMutation.body.data.setPermissionGrant).toMatchObject({
      clientKey: 'claude',
      target: 'food.*',
      action: 'READ',
      effect: 'DENY',
    });

    const query = await graphQlPost(`
      query MyGrants {
        myPermissionGrants {
          clientKey
          target
          action
          effect
        }
      }
    `);

    expect(query.body.errors).toBeUndefined();
    expect(query.body.data.myPermissionGrants).toHaveLength(1);

    const removeMutation = await graphQlPost(`
      mutation RemoveGrant {
        removePermissionGrant(
          clientKey: "claude"
          target: "food.*"
          action: READ
        )
      }
    `);

    expect(removeMutation.body.errors).toBeUndefined();
    expect(removeMutation.body.data.removePermissionGrant).toBe(true);
  });

  it('filters myPermissionGrants by clientKey', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );
    await grantRepository.upsert(
      testUser.userId,
      'codex',
      'system.*',
      'READ',
      'ALLOW',
    );

    const response = await graphQlPost(
      `
        query MyGrants($clientKey: String) {
          myPermissionGrants(clientKey: $clientKey) {
            clientKey
            target
            action
            effect
          }
        }
      `,
      {
        clientKey: 'claude',
      },
    );

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.myPermissionGrants).toEqual([
      expect.objectContaining({
        clientKey: 'claude',
        target: 'food.*',
        action: 'READ',
        effect: 'DENY',
      }),
    ]);
  });

  it('rejects invalid client keys when filtering myPermissionGrants', async () => {
    const response = await graphQlPost(
      `
        query MyGrants($clientKey: String) {
          myPermissionGrants(clientKey: $clientKey) {
            clientKey
          }
        }
      `,
      {
        clientKey: 'codeex',
      },
    );

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toBe(
      'Invalid permission grant clientKey: "codeex". Expected one of: claude, codex, fallback',
    );
  });

  it('rejects invalid client keys in GraphQL grant mutations', async () => {
    const response = await graphQlPost(
      `
        mutation SetGrant($input: SetPermissionGrantInput!) {
          setPermissionGrant(input: $input) {
            clientKey
          }
        }
      `,
      {
        input: {
          clientKey: 'codeex',
          target: 'food.*',
          action: 'READ',
          effect: 'DENY',
        },
      },
    );

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toBe('Bad Request Exception');

    const query = await graphQlPost(`
      query MyGrants {
        myPermissionGrants {
          clientKey
        }
      }
    `);

    expect(query.body.errors).toBeUndefined();
    expect(query.body.data.myPermissionGrants).toEqual([]);
  });

  it('rejects invalid client keys in removePermissionGrant', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const response = await graphQlPost(`
      mutation RemoveGrant {
        removePermissionGrant(
          clientKey: "codeex"
          target: "food.*"
          action: READ
        )
      }
    `);

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toBe(
      'Invalid permission grant clientKey: "codeex". Expected one of: claude, codex, fallback',
    );

    const query = await graphQlPost(`
      query MyGrants {
        myPermissionGrants {
          clientKey
          target
          action
        }
      }
    `);

    expect(query.body.errors).toBeUndefined();
    expect(query.body.data.myPermissionGrants).toEqual([
      expect.objectContaining({
        clientKey: 'claude',
        target: 'food.*',
        action: 'READ',
      }),
    ]);
  });

  it('rejects invalid grant targets in GraphQL grant mutations', async () => {
    const response = await graphQlPost(
      `
        mutation SetGrant($input: SetPermissionGrantInput!) {
          setPermissionGrant(input: $input) {
            target
          }
        }
      `,
      {
        input: {
          clientKey: 'claude',
          target: 'food*',
          action: 'READ',
          effect: 'DENY',
        },
      },
    );

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toBe('Bad Request Exception');

    const query = await graphQlPost(`
      query MyGrants {
        myPermissionGrants {
          target
        }
      }
    `);

    expect(query.body.errors).toBeUndefined();
    expect(query.body.data.myPermissionGrants).toEqual([]);
  });

  it('rejects invalid targets in removePermissionGrant', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const response = await graphQlPost(`
      mutation RemoveGrant {
        removePermissionGrant(
          clientKey: "claude"
          target: "food*"
          action: READ
        )
      }
    `);

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toBe(
      'Invalid permission grant target: "food*". Expected "*", "<category>.*", "<nested.prefix>.*", or an exact slug.',
    );

    const query = await graphQlPost(`
      query MyGrants {
        myPermissionGrants {
          clientKey
          target
          action
        }
      }
    `);

    expect(query.body.errors).toBeUndefined();
    expect(query.body.data.myPermissionGrants).toEqual([
      expect.objectContaining({
        clientKey: 'claude',
        target: 'food.*',
        action: 'READ',
      }),
    ]);
  });

  it('treats removePermissionGrant as idempotent', async () => {
    await grantRepository.upsert(
      testUser.userId,
      'claude',
      'food.*',
      'READ',
      'DENY',
    );

    const mutation = `
      mutation RemoveGrant {
        removePermissionGrant(
          clientKey: "claude"
          target: "food.*"
          action: READ
        )
      }
    `;

    const first = await graphQlPost(mutation);
    expect(first.body.errors).toBeUndefined();
    expect(first.body.data.removePermissionGrant).toBe(true);

    const second = await graphQlPost(mutation);
    expect(second.body.errors).toBeUndefined();
    expect(second.body.data.removePermissionGrant).toBe(true);
  });

  it('rejects unauthenticated GraphQL access to permission grants', async () => {
    const response = await request(realAuthApp.getHttpServer())
      .post('/graphql')
      .send({
        query: `
          query MyGrants {
            myPermissionGrants {
              clientKey
            }
          }
        `,
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toBe('Missing Authorization header');
  });
});
