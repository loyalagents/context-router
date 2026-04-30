import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createMockStructuredAiService,
  createTestApp,
  createTestUser,
  TestUser,
} from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import {
  AuditEventType,
  McpAccessOutcome,
  McpAccessSurface,
} from '../../src/infrastructure/prisma/generated-client';
import { McpAccessLogService } from '../../src/mcp/access-log/mcp-access-log.service';

const TEST_CLIENT_IDS = {
  claude: process.env.AUTH0_MCP_CLAUDE_CLIENT_ID!,
  codex: process.env.AUTH0_MCP_CODEX_CLIENT_ID!,
  fallback: process.env.AUTH0_MCP_FALLBACK_CLIENT_ID!,
  unknown: 'test-unknown-client',
};

describe('MCP Access Log (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let accessLogService: McpAccessLogService;
  let mocks: {
    structuredAi: ReturnType<typeof createMockStructuredAiService>;
    [key: string]: any;
  };
  const prisma = getPrismaClient();

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    accessLogService =
      testApp.module.get<McpAccessLogService>(McpAccessLogService);
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

  const callTool = (
    name: string,
    args: object = {},
    headers: Record<string, string> = {},
  ) =>
    mcpPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      headers,
    );

  const mutatePreferences = (
    args: object = {},
    headers: Record<string, string> = {},
  ) => callTool('mutatePreferences', args, headers);

  const readResource = (uri: string, headers: Record<string, string> = {}) =>
    mcpPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri },
      },
      headers,
    );

  const MCP_ACCESS_HISTORY_QUERY = `
    query McpAccessHistory($input: McpAccessHistoryInput!) {
      mcpAccessHistory(input: $input) {
        hasNextPage
        nextCursor
        items {
          id
          userId
          clientKey
          occurredAt
          surface
          operationName
          outcome
          correlationId
          latencyMs
          requestMetadata
          responseMetadata
          errorMetadata
        }
      }
    }
  `;

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  const parseToolResult = (response: any) =>
    response.body.result.structuredContent ??
    JSON.parse(response.body.result.content[0].text);

  it('records searchPreferences success with sanitized metadata', async () => {
    const definition = await prisma.preferenceDefinition.findFirstOrThrow({
      where: { slug: 'food.dietary_restrictions' },
    });
    await prisma.preference.create({
      data: {
        userId: testUser.userId,
        definitionId: definition.id,
        contextKey: 'GLOBAL',
        value: JSON.stringify(['gluten-free']),
        status: 'ACTIVE',
        sourceType: 'USER',
      },
    });

    const response = await callTool('searchPreferences', {
      query: 'food',
      includeSuggestions: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.result?.isError).not.toBe(true);

    const events = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUser.userId },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      clientKey: 'claude',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'searchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      requestMetadata: {
        locationId: null,
        includeSuggestions: true,
        queryPresent: true,
        queryLength: 4,
      },
      responseMetadata: {
        activeCount: 1,
        suggestedCount: 0,
      },
    });
    expect(events[0].correlationId).toBeTruthy();
    expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records listPreferenceSlugs, listPermissionGrants, and schema resource metadata', async () => {
    await callTool('listPreferenceSlugs', { category: 'food' }).expect(200);
    await callTool('listPermissionGrants').expect(200);
    await readResource('schema://graphql').expect(200);

    const events = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUser.userId },
      orderBy: { occurredAt: 'asc' },
    });

    expect(events.map((event) => event.operationName)).toEqual([
      'listPreferenceSlugs',
      'listPermissionGrants',
      'schema://graphql',
    ]);
    expect(events[0]).toMatchObject({
      outcome: McpAccessOutcome.SUCCESS,
      requestMetadata: { category: 'food' },
    });
    expect(
      (events[0].responseMetadata as { count?: number; categories?: string[] })
        .count,
    ).toBeGreaterThan(0);
    expect(events[1].responseMetadata).toEqual({ grantCount: 0 });
    expect(events[2]).toMatchObject({
      surface: McpAccessSurface.RESOURCES_READ,
      responseMetadata: expect.objectContaining({
        cacheHit: expect.any(Boolean),
        byteLength: expect.any(Number),
      }),
    });
  });

  it('records workflow-backed read tool metadata', async () => {
    const definition = await prisma.preferenceDefinition.findFirstOrThrow({
      where: { slug: 'food.dietary_restrictions' },
    });
    await prisma.preference.create({
      data: {
        userId: testUser.userId,
        definitionId: definition.id,
        contextKey: 'GLOBAL',
        value: JSON.stringify(['vegan']),
        status: 'ACTIVE',
        sourceType: 'USER',
      },
    });
    await prisma.preferenceDefinition.createMany({
      data: [
        {
          namespace: `USER:${testUser.userId}`,
          slug: 'food.diet_restrictions',
          description: 'Diet restrictions',
          valueType: 'ARRAY',
          scope: 'GLOBAL',
          ownerUserId: testUser.userId,
        },
        {
          namespace: `USER:${testUser.userId}`,
          slug: 'food.dietary_requirements',
          description: 'Diet requirements',
          valueType: 'ARRAY',
          scope: 'GLOBAL',
          ownerUserId: testUser.userId,
        },
      ],
    });
    mocks.structuredAi.generateStructured
      .mockResolvedValueOnce({
        relevantSlugs: ['food.dietary_restrictions'],
        queryInterpretation: 'food preferences',
      })
      .mockResolvedValueOnce({
        consolidationGroups: [
          {
            slugs: ['food.diet_restrictions', 'food.dietary_requirements'],
            reason: 'Both describe dietary needs',
            suggestion: 'MERGE',
          },
        ],
        summary: 'Found one consolidation group',
      });

    await callTool('smartSearchPreferences', {
      query: 'what food preferences do I have?',
      includeSuggestions: true,
    }).expect(200);
    await callTool('consolidateSchema', { scope: 'PERSONAL' }).expect(200);

    const events = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUser.userId },
      orderBy: { occurredAt: 'asc' },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      operationName: 'smartSearchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      requestMetadata: {
        locationId: null,
        includeSuggestions: true,
        queryPresent: true,
        queryLength: 32,
      },
      responseMetadata: {
        matchedDefinitionCount: 1,
        matchedActiveCount: 1,
        matchedSuggestedCount: 0,
      },
    });
    expect(events[1]).toMatchObject({
      operationName: 'consolidateSchema',
      requestMetadata: { scope: 'PERSONAL' },
      responseMetadata: {
        totalDefinitionsAnalyzed: 2,
        consolidationGroupCount: 1,
      },
    });
  });

  it('records dispatch denial and dispatch errors with sources', async () => {
    await callTool(
      'searchPreferences',
      {},
      mcpHeaders(TEST_CLIENT_IDS.unknown),
    ).expect(200);
    await callTool('definitelyUnknownTool').expect(200);
    await readResource('schema://missing').expect(200);

    const events = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUser.userId },
      orderBy: { occurredAt: 'asc' },
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      clientKey: 'unknown',
      operationName: 'searchPreferences',
      outcome: McpAccessOutcome.DENY,
      errorMetadata: expect.objectContaining({ source: 'AUTHORIZATION' }),
    });
    expect(events[1]).toMatchObject({
      operationName: 'definitelyUnknownTool',
      outcome: McpAccessOutcome.ERROR,
      errorMetadata: expect.objectContaining({ source: 'DISPATCH' }),
    });
    expect(events[2]).toMatchObject({
      operationName: 'schema://missing',
      outcome: McpAccessOutcome.ERROR,
      errorMetadata: expect.objectContaining({ source: 'DISPATCH' }),
    });
  });

  it('records resources/read authorization denial with authorization source', async () => {
    await readResource(
      'schema://graphql',
      mcpHeaders(TEST_CLIENT_IDS.unknown),
    ).expect(200);

    const event = await prisma.mcpAccessEvent.findFirstOrThrow({
      where: { userId: testUser.userId },
    });

    expect(event).toMatchObject({
      clientKey: 'unknown',
      surface: McpAccessSurface.RESOURCES_READ,
      operationName: 'schema://graphql',
      outcome: McpAccessOutcome.DENY,
      errorMetadata: expect.objectContaining({ source: 'AUTHORIZATION' }),
    });
  });

  it('records tool-result errors separately from dispatch errors', async () => {
    mocks.structuredAi.generateStructured.mockRejectedValue(
      new Error('Zod validation failed: expected string, got number'),
    );

    const response = await callTool('smartSearchPreferences', {
      query: 'food preferences',
    });

    expect(response.status).toBe(200);
    expect(response.body.result?.isError).toBe(true);
    expect(parseToolResult(response).success).toBe(false);

    const event = await prisma.mcpAccessEvent.findFirstOrThrow({
      where: { userId: testUser.userId },
    });

    expect(event).toMatchObject({
      operationName: 'smartSearchPreferences',
      outcome: McpAccessOutcome.ERROR,
      errorMetadata: expect.objectContaining({
        source: 'TOOL_RESULT',
        message: expect.stringContaining('Zod validation failed'),
      }),
    });
  });

  it('does not log tools/list or resources/list', async () => {
    await mcpPost({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }).expect(200);
    await mcpPost({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list',
      params: {},
    }).expect(200);

    await expect(
      prisma.mcpAccessEvent.count({ where: { userId: testUser.userId } }),
    ).resolves.toBe(0);
  });

  it('records mutatePreferences success, validation errors, and denials with sanitized metadata', async () => {
    const successResponse = await mutatePreferences(
      {
        operation: 'SET_PREFERENCE',
        preference: {
          slug: 'system.response_length',
          value: '"brief"',
          confidence: 0.8,
          evidence: {
            source: 'access-log-test',
            snippet: 'Do not store this raw evidence in MCP access logs',
          },
        },
      },
      mcpHeaders(TEST_CLIENT_IDS.codex),
    );

    expect(successResponse.status).toBe(200);
    expect(successResponse.body.result?.isError).not.toBe(true);

    const invalidResponse = await mutatePreferences(
      {
        operation: 'NOT_A_REAL_OPERATION',
      },
      mcpHeaders(TEST_CLIENT_IDS.codex),
    );
    expect(invalidResponse.status).toBe(200);
    expect(invalidResponse.body.result?.isError).toBe(true);

    await prisma.permissionGrant.create({
      data: {
        userId: testUser.userId,
        clientKey: 'codex',
        target: 'food.*',
        action: 'SUGGEST',
        effect: 'DENY',
      },
    });

    const deniedResponse = await mutatePreferences(
      {
        operation: 'SUGGEST_PREFERENCE',
        preference: {
          slug: 'food.dietary_restrictions',
          value: '["nuts"]',
          confidence: 0.9,
        },
      },
      mcpHeaders(TEST_CLIENT_IDS.codex),
    );
    expect(deniedResponse.status).toBe(200);
    expect(deniedResponse.body.result?.isError).toBe(true);

    const events = await prisma.mcpAccessEvent.findMany({
      where: {
        userId: testUser.userId,
        operationName: 'mutatePreferences',
      },
      orderBy: { occurredAt: 'asc' },
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      outcome: McpAccessOutcome.SUCCESS,
      requestMetadata: {
        operation: 'SET_PREFERENCE',
        target: 'system.response_length',
        requiredPermission: 'WRITE',
      },
      responseMetadata: expect.objectContaining({
        success: true,
        changed: true,
        preferenceId: expect.any(String),
        definitionId: null,
      }),
    });
    expect(events[1]).toMatchObject({
      outcome: McpAccessOutcome.ERROR,
      errorMetadata: expect.objectContaining({
        source: 'TOOL_RESULT',
        code: 'INVALID_MUTATION_OPERATION',
      }),
    });
    expect(events[2]).toMatchObject({
      outcome: McpAccessOutcome.DENY,
      requestMetadata: {
        operation: 'SUGGEST_PREFERENCE',
        target: 'food.dietary_restrictions',
        requiredPermission: 'SUGGEST',
      },
      errorMetadata: expect.objectContaining({
        source: 'AUTHORIZATION',
        code: 'MCP_PERMISSION_DENIED',
      }),
    });

    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain('brief');
    expect(serializedEvents).not.toContain('access-log-test');
    expect(serializedEvents).not.toContain('nuts');

    const auditRows = await prisma.preferenceAuditEvent.findMany({
      where: {
        userId: testUser.userId,
        eventType: AuditEventType.PREFERENCE_SET,
      },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].correlationId).toBe(events[0].correlationId);
  });

  it('records coarse dispatch denials for mutation clients with no mutation capability', async () => {
    const response = await mutatePreferences(
      {
        operation: 'SET_PREFERENCE',
        preference: {
          slug: 'system.response_length',
          value: '"brief"',
        },
      },
      mcpHeaders(TEST_CLIENT_IDS.fallback),
    );

    expect(response.status).toBe(200);
    expect(response.body.result?.isError).toBe(true);

    const event = await prisma.mcpAccessEvent.findFirstOrThrow({
      where: {
        userId: testUser.userId,
        operationName: 'mutatePreferences',
      },
    });

    expect(event).toMatchObject({
      clientKey: 'fallback',
      surface: McpAccessSurface.TOOLS_CALL,
      outcome: McpAccessOutcome.DENY,
      errorMetadata: expect.objectContaining({
        source: 'AUTHORIZATION',
        message: expect.stringContaining(
          'is not allowed to call tool "mutatePreferences"',
        ),
      }),
    });
  });

  it('sanitizes access-log metadata for definition mutation success', async () => {
    const response = await mutatePreferences(
      {
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'access_log.definition_sanitization',
          description: 'raw definition description should not be copied',
          valueType: 'ENUM',
          scope: 'GLOBAL',
          options: ['raw_option_one', 'raw_option_two'],
        },
      },
      mcpHeaders(TEST_CLIENT_IDS.codex),
    );

    expect(response.status).toBe(200);
    expect(response.body.result?.isError).not.toBe(true);

    const event = await prisma.mcpAccessEvent.findFirstOrThrow({
      where: {
        userId: testUser.userId,
        operationName: 'mutatePreferences',
      },
    });

    expect(event).toMatchObject({
      outcome: McpAccessOutcome.SUCCESS,
      requestMetadata: {
        operation: 'CREATE_DEFINITION',
        target: 'access_log.definition_sanitization',
        requiredPermission: 'DEFINE',
      },
      responseMetadata: expect.objectContaining({
        success: true,
        changed: true,
        preferenceId: null,
        definitionId: expect.any(String),
      }),
    });

    const serializedEvent = JSON.stringify(event);
    expect(serializedEvent).not.toContain(
      'raw definition description should not be copied',
    );
    expect(serializedEvent).not.toContain('raw_option_one');
    expect(serializedEvent).not.toContain('raw_option_two');
  });

  it('does not fail the MCP response when access logging fails', async () => {
    const recordSpy = jest
      .spyOn(accessLogService, 'record')
      .mockRejectedValueOnce(new Error('access log unavailable'));

    try {
      const response = await callTool('listPreferenceSlugs', {});

      expect(response.status).toBe(200);
      expect(response.body.result?.isError).not.toBe(true);
      expect(recordSpy).toHaveBeenCalled();
      await expect(prisma.mcpAccessEvent.count()).resolves.toBe(0);
    } finally {
      recordSpy.mockRestore();
    }
  });

  it('does not fail resource reads or mask resource errors when access logging fails', async () => {
    const recordSpy = jest
      .spyOn(accessLogService, 'record')
      .mockRejectedValue(new Error('access log unavailable'));

    try {
      const successResponse = await readResource('schema://graphql');
      expect(successResponse.status).toBe(200);
      expect(successResponse.body.result?.contents).toEqual(expect.any(Array));

      const errorResponse = await readResource('schema://missing');
      expect(errorResponse.status).toBe(200);
      expect(errorResponse.body.error).toBeDefined();
      expect(errorResponse.body.error.message).toContain(
        'Unknown resource: schema://missing',
      );

      expect(recordSpy).toHaveBeenCalledTimes(2);
      await expect(prisma.mcpAccessEvent.count()).resolves.toBe(0);
    } finally {
      recordSpy.mockRestore();
    }
  });

  it('exposes user-scoped MCP access history through GraphQL filters', async () => {
    await callTool(
      'searchPreferences',
      { query: 'food' },
      mcpHeaders(TEST_CLIENT_IDS.codex),
    ).expect(200);
    await callTool('listPreferenceSlugs').expect(200);

    const response = await graphqlRequest(MCP_ACCESS_HISTORY_QUERY, {
      input: {
        clientKey: 'codex',
        surface: 'TOOLS_CALL',
        operationName: 'searchPreferences',
        outcome: 'SUCCESS',
        first: 5,
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.mcpAccessHistory).toMatchObject({
      hasNextPage: false,
      nextCursor: null,
    });
    expect(response.body.data.mcpAccessHistory.items).toHaveLength(1);
    expect(response.body.data.mcpAccessHistory.items[0]).toMatchObject({
      userId: testUser.userId,
      clientKey: 'codex',
      surface: 'TOOLS_CALL',
      operationName: 'searchPreferences',
      outcome: 'SUCCESS',
    });
  });

  it('paginates MCP access history with cursors', async () => {
    await prisma.mcpAccessEvent.createMany({
      data: [
        {
          userId: testUser.userId,
          clientKey: 'claude',
          occurredAt: new Date('2026-04-18T10:00:00.000Z'),
          surface: McpAccessSurface.TOOLS_CALL,
          operationName: 'searchPreferences',
          outcome: McpAccessOutcome.SUCCESS,
          correlationId: 'mcp-access-cursor-1',
          latencyMs: 1,
        },
        {
          userId: testUser.userId,
          clientKey: 'claude',
          occurredAt: new Date('2026-04-18T11:00:00.000Z'),
          surface: McpAccessSurface.TOOLS_CALL,
          operationName: 'listPreferenceSlugs',
          outcome: McpAccessOutcome.SUCCESS,
          correlationId: 'mcp-access-cursor-2',
          latencyMs: 2,
        },
        {
          userId: testUser.userId,
          clientKey: 'claude',
          occurredAt: new Date('2026-04-18T12:00:00.000Z'),
          surface: McpAccessSurface.RESOURCES_READ,
          operationName: 'schema://graphql',
          outcome: McpAccessOutcome.SUCCESS,
          correlationId: 'mcp-access-cursor-3',
          latencyMs: 3,
        },
      ],
    });

    const firstPageResponse = await graphqlRequest(MCP_ACCESS_HISTORY_QUERY, {
      input: { first: 2 },
    }).expect(200);

    expect(firstPageResponse.body.errors).toBeUndefined();
    const firstPage = firstPageResponse.body.data.mcpAccessHistory;

    expect(firstPage.hasNextPage).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(
      firstPage.items.map(
        (item: { operationName: string }) => item.operationName,
      ),
    ).toEqual(['schema://graphql', 'listPreferenceSlugs']);

    const secondPageResponse = await graphqlRequest(MCP_ACCESS_HISTORY_QUERY, {
      input: { first: 2, after: firstPage.nextCursor },
    }).expect(200);

    expect(secondPageResponse.body.errors).toBeUndefined();
    expect(secondPageResponse.body.data.mcpAccessHistory).toMatchObject({
      hasNextPage: false,
      nextCursor: null,
    });
    expect(secondPageResponse.body.data.mcpAccessHistory.items).toHaveLength(1);
    expect(
      secondPageResponse.body.data.mcpAccessHistory.items[0].operationName,
    ).toBe('searchPreferences');
  });

  it('returns GraphQL errors for invalid MCP access history cursors', async () => {
    const response = await graphqlRequest(MCP_ACCESS_HISTORY_QUERY, {
      input: { after: 'not-a-valid-cursor' },
    }).expect(200);

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toContain(
      'Invalid MCP access history cursor',
    );
  });

  it('keeps MCP access history GraphQL results isolated to the authenticated user', async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: 'other-mcp-access-user@example.com',
        firstName: 'Other',
        lastName: 'User',
      },
    });

    await prisma.mcpAccessEvent.createMany({
      data: [
        {
          userId: testUser.userId,
          clientKey: 'claude',
          surface: McpAccessSurface.TOOLS_CALL,
          operationName: 'searchPreferences',
          outcome: McpAccessOutcome.SUCCESS,
          correlationId: 'mcp-access-primary-user',
          latencyMs: 5,
        },
        {
          userId: otherUser.userId,
          clientKey: 'claude',
          surface: McpAccessSurface.TOOLS_CALL,
          operationName: 'listPreferenceSlugs',
          outcome: McpAccessOutcome.SUCCESS,
          correlationId: 'mcp-access-other-user',
          latencyMs: 6,
        },
      ],
    });

    const response = await graphqlRequest(MCP_ACCESS_HISTORY_QUERY, {
      input: { first: 10 },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.mcpAccessHistory.items).toHaveLength(1);
    expect(response.body.data.mcpAccessHistory.items[0]).toMatchObject({
      userId: testUser.userId,
      operationName: 'searchPreferences',
    });
  });
});
