import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PermissionGrantRepository } from '../../src/modules/permission-grant/permission-grant.repository';
import { PreferenceService } from '../../src/modules/preferences/preference/preference.service';
import { PreferenceDefinitionService } from '../../src/modules/preferences/preference-definition/preference-definition.service';

const TEST_CLIENT_IDS = {
  claude: process.env.AUTH0_MCP_CLAUDE_CLIENT_ID!,
  codex: process.env.AUTH0_MCP_CODEX_CLIENT_ID!,
};

describe('Permission Grants (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let registerMcpUser: (user: TestUser) => void;
  let grantRepository: PermissionGrantRepository;
  let preferenceService: PreferenceService;
  let preferenceDefinitionService: PreferenceDefinitionService;
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
  });

  afterAll(async () => {
    await app.close();
  });

  const mcpHeaders = (
    clientId: string,
    extra: Record<string, string> = {},
  ) => ({
    'x-test-mcp-client-id': clientId,
    'x-test-user-id': testUser.userId,
    ...extra,
  });

  const mcpToolCall = async (
    name: string,
    args: Record<string, unknown>,
    clientId = TEST_CLIENT_IDS.claude,
  ) => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(mcpHeaders(clientId))
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });

    expect(response.status).toBe(200);
    return response.body.result;
  };

  const graphQlPost = async (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables });

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
      await mcpToolCall('listPermissionGrants', {}, TEST_CLIENT_IDS.claude),
    );
    expect(claudeResult.grants).toHaveLength(1);
    expect(claudeResult.grants[0].clientKey).toBe('claude');

    const codexResult = parseToolResult(
      await mcpToolCall('listPermissionGrants', {}, TEST_CLIENT_IDS.codex),
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
});
