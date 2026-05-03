import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { McpService } from '../../src/mcp/mcp.service';
import { getPrismaClient, seedPreferenceDefinitions } from '../setup/test-db';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ResolvedMcpClient } from '../../src/mcp/types/mcp-authorization.types';
import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
} from '../../src/infrastructure/prisma/generated-client';

const TEST_CLIENT_IDS = {
  claude: process.env.AUTH0_MCP_CLAUDE_CLIENT_ID!,
  codex: process.env.AUTH0_MCP_CODEX_CLIENT_ID!,
  fallback: process.env.AUTH0_MCP_FALLBACK_CLIENT_ID!,
  unknown: 'test-unknown-client',
};

const TEST_CLAUDE_CLIENT: ResolvedMcpClient = {
  key: 'claude',
  externalId: TEST_CLIENT_IDS.claude,
  policy: {
    key: 'claude',
    label: 'Claude',
    capabilities: [
      'preferences:read',
      'preferences:suggest',
      'preferences:write',
      'preferences:define',
    ],
    targetRules: [],
  },
};

const parseReadToolResult = (result: any) =>
  result.structuredContent ?? JSON.parse(result.content[0].text);

describe('MCP Integration (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let registerMcpUser: (user: TestUser) => void;
  let mcpService: McpService;
  let configService: ConfigService;
  const prisma = getPrismaClient();

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    registerMcpUser = testApp.registerMcpUser;
    mcpService = testApp.module.get<McpService>(McpService);
    configService = testApp.module.get<ConfigService>(ConfigService);
  });

  beforeEach(async () => {
    testUser = await createTestUser();
    setTestUser(testUser);
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

  const mcpHeaders = (
    clientId: string,
    extra: Record<string, string> = {},
  ) => ({
    'x-test-mcp-client-id': clientId,
    ...extra,
  });

  const mutatePreferences = (
    args: object,
    headers: Record<string, string> = {},
    id = 1,
  ) =>
    mcpPost(
      {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: 'mutatePreferences',
          arguments: args,
        },
      },
      headers,
    );

  describe('MCP Service', () => {
    it('should be defined', () => {
      expect(mcpService).toBeDefined();
    });

    it('should create a distinct server per call', () => {
      const context = { user: testUser, client: TEST_CLAUDE_CLIENT };
      const serverA = mcpService.createServer(context);
      const serverB = mcpService.createServer(context);
      expect(serverA).not.toBe(serverB);
    });

    it('should expose initialize instructions and the bumped server version', async () => {
      const context = {
        user: testUser,
        client: TEST_CLAUDE_CLIENT,
        grants: ['preferences:read'],
      };
      const server = mcpService.createServer(context as any);
      const client = new Client(
        { name: 'mcp-contract-test', version: '1.0.0' },
        { capabilities: {} },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();

      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getServerVersion()).toMatchObject({
        name: 'context-router-mcp',
        version: '2.0.0',
      });
      expect(client.getInstructions()).toContain(
        'Available tools vary by permissions.',
      );
      expect(client.getInstructions()).toContain('searchPreferences');
      expect(client.getInstructions()).toContain('smartSearchPreferences');

      await client.close();
      await server.close();
    });
  });

  describe('MCP Configuration', () => {
    it('should load MCP configuration', () => {
      const mcpConfig = configService.get('mcp');

      expect(mcpConfig).toBeDefined();
      expect(mcpConfig.server).toBeDefined();
      expect(mcpConfig.server.name).toBe('context-router-mcp');
      expect(mcpConfig.server.version).toBe('2.0.0');
    });

    it('should have HTTP transport enabled by default', () => {
      const httpTransport = configService.get('mcp.httpTransport');

      expect(httpTransport).toBeDefined();
      expect(httpTransport.enabled).toBe(true);
      expect(httpTransport.path).toBe('/mcp');
    });

    it('should have preference tools enabled', () => {
      const toolsEnabled = configService.get('mcp.tools.preferences.enabled');
      expect(toolsEnabled).toBe(true);
    });

    it('should have schema resources enabled', () => {
      const resourcesEnabled = configService.get(
        'mcp.resources.schema.enabled',
      );
      expect(resourcesEnabled).toBe(true);
    });
  });

  describe('POST /mcp', () => {
    it('should return tools list', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });

      expect(response.status).toBe(200);
      expect(response.body.result?.tools).toBeDefined();
      const tools = response.body.result.tools;
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('searchPreferences');
      expect(toolNames).toContain('listPreferenceSlugs');

      for (const toolName of [
        'listPreferenceSlugs',
        'searchPreferences',
        'smartSearchPreferences',
        'listPermissionGrants',
        'consolidateSchema',
      ]) {
        const tool = tools.find((candidate: any) => candidate.name === toolName);
        expect(tool.outputSchema).toBeDefined();
        expect(tool.outputSchema.type).toBe('object');
        expect(tool.outputSchema.properties.success).toBeDefined();
      }

      const mutatePreferencesTool = tools.find(
        (tool: any) => tool.name === 'mutatePreferences',
      );
      expect(mutatePreferencesTool.outputSchema).toBeUndefined();
    });

    it('should execute listPreferenceSlugs tool', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'listPreferenceSlugs',
          arguments: {},
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.result?.content).toBeDefined();
      expect(response.body.result?.structuredContent).toBeDefined();

      const result = parseReadToolResult(response.body.result);
      const profileFullName = result.preferences.find(
        (pref: any) => pref.slug === 'profile.full_name',
      );
      expect(profileFullName).toMatchObject({
        displayName: 'Full Name',
        valueType: 'STRING',
        scope: 'GLOBAL',
      });
    });
  });

  describe('Client policy enforcement', () => {
    beforeEach(async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);
    });

    it('should expose mutatePreferences in tools/list for codex and hide old mutation tools', async () => {
      const response = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 30,
          method: 'tools/list',
          params: {},
        },
        mcpHeaders(TEST_CLIENT_IDS.codex),
      );

      expect(response.status).toBe(200);
      const toolNames = response.body.result.tools.map(
        (tool: any) => tool.name,
      );
      expect(toolNames).toContain('searchPreferences');
      expect(toolNames).toContain('mutatePreferences');
      expect(toolNames).not.toContain('suggestPreference');
      expect(toolNames).not.toContain('createPreferenceDefinition');
      expect(toolNames).not.toContain('deletePreference');
    });

    it('should allow SUGGEST_PREFERENCE for codex', async () => {
      const response = await mutatePreferences(
        {
          operation: 'SUGGEST_PREFERENCE',
          preference: {
            slug: 'food.dietary_restrictions',
            value: '["nuts"]',
            confidence: 0.9,
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.codex),
        31,
      );

      expect(response.status).toBe(200);
      expect(response.body.result?.isError).not.toBe(true);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.preference).toMatchObject({
        slug: 'food.dietary_restrictions',
        status: 'SUGGESTED',
        lastModifiedBy: {
          actorType: 'MCP_CLIENT',
          actorClientKey: 'codex',
          origin: 'MCP',
        },
      });

      const stored = await prisma.preference.findUniqueOrThrow({
        where: { id: result.preference.id },
      });
      expect(stored).toMatchObject({
        lastActorType: AuditActorType.MCP_CLIENT,
        lastActorClientKey: 'codex',
        lastOrigin: AuditOrigin.MCP,
      });

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
        },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        actorType: AuditActorType.MCP_CLIENT,
        actorClientKey: 'codex',
        origin: AuditOrigin.MCP,
      });
      expect(auditRows[0].correlationId).toBeTruthy();
    });

    it('should canonicalize array values in SUGGEST_PREFERENCE for codex', async () => {
      const response = await mutatePreferences(
        {
          operation: 'SUGGEST_PREFERENCE',
          preference: {
            slug: 'dev.tech_stack',
            value: '["AI", " software engineering ", "AI", ""]',
            confidence: 0.91,
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.codex),
        31,
      );

      expect(response.status).toBe(200);
      expect(response.body.result?.isError).not.toBe(true);

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.preference).toMatchObject({
        slug: 'dev.tech_stack',
        value: ['AI', 'software engineering'],
      });
    });

    it('should hide and deny mutatePreferences for fallback', async () => {
      const listResponse = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 32,
          method: 'tools/list',
          params: {},
        },
        mcpHeaders(TEST_CLIENT_IDS.fallback),
      );
      const toolNames = listResponse.body.result.tools.map(
        (tool: any) => tool.name,
      );
      expect(toolNames).toContain('searchPreferences');
      expect(toolNames).not.toContain('mutatePreferences');

      const response = await mutatePreferences(
        {
          operation: 'SUGGEST_PREFERENCE',
          preference: {
            slug: 'food.dietary_restrictions',
            value: '["shellfish"]',
            confidence: 0.8,
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.fallback),
        32,
      );

      expect(response.status).toBe(200);
      expect(response.body.result?.isError).toBe(true);
    });

    it('should return an empty tools list for unknown clients', async () => {
      const response = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 33,
          method: 'tools/list',
          params: {},
        },
        mcpHeaders(TEST_CLIENT_IDS.unknown),
      );

      expect(response.status).toBe(200);
      expect(response.body.result?.tools).toEqual([]);
    });

    it('should deny tool execution for unknown clients', async () => {
      const response = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 34,
          method: 'tools/call',
          params: {
            name: 'searchPreferences',
            arguments: {},
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.unknown),
      );

      expect(response.status).toBe(200);
      expect(response.body.result?.isError).toBe(true);
    });

    it('should still allow policy-authorized access when grant claims are absent', async () => {
      const response = await mutatePreferences(
        {
          operation: 'SUGGEST_PREFERENCE',
          preference: {
            slug: 'food.dietary_restrictions',
            value: '["dairy"]',
            confidence: 0.7,
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.claude, {
          'x-test-mcp-grants': '__absent__',
        }),
        35,
      );

      expect(response.status).toBe(200);
      expect(response.body.result?.isError).not.toBe(true);
    });

    it('should return unknown-tool errors for old MCP mutation tool names', async () => {
      for (const name of [
        'suggestPreference',
        'createPreferenceDefinition',
        'deletePreference',
      ]) {
        const response = await mcpPost(
          {
            jsonrpc: '2.0',
            id: 36,
            method: 'tools/call',
            params: {
              name,
              arguments: {},
            },
          },
          mcpHeaders(TEST_CLIENT_IDS.codex),
        );

        expect(response.status).toBe(200);
        expect(response.body.result?.isError).toBe(true);
        expect(
          JSON.parse(response.body.result.content[0].text).error,
        ).toContain(`Unknown tool: ${name}`);
      }
    });

    it('should intersect token grants with policy capabilities for DEFINE-only clients', async () => {
      const defineOnlyHeaders = mcpHeaders(TEST_CLIENT_IDS.claude, {
        'x-test-mcp-grants': 'preferences:define',
      });

      const listResponse = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 37,
          method: 'tools/list',
          params: {},
        },
        defineOnlyHeaders,
      );
      const toolNames = listResponse.body.result.tools.map(
        (tool: any) => tool.name,
      );
      expect(toolNames).toContain('mutatePreferences');

      const createResponse = await mutatePreferences(
        {
          operation: 'CREATE_DEFINITION',
          definition: {
            slug: 'token.define_only',
            description: 'Definition created with only DEFINE token grants',
            valueType: 'STRING',
            scope: 'GLOBAL',
          },
        },
        defineOnlyHeaders,
        38,
      );
      expect(createResponse.status).toBe(200);
      expect(createResponse.body.result?.isError).not.toBe(true);

      const suggestResponse = await mutatePreferences(
        {
          operation: 'SUGGEST_PREFERENCE',
          preference: {
            slug: 'system.response_tone',
            value: '"concise"',
            confidence: 0.9,
          },
        },
        defineOnlyHeaders,
        39,
      );
      const suggestResult = JSON.parse(
        suggestResponse.body.result.content[0].text,
      );
      expect(suggestResponse.body.result?.isError).toBe(true);
      expect(suggestResult).toMatchObject({
        success: false,
        changed: false,
        code: 'MCP_PERMISSION_DENIED',
        requiredPermission: 'SUGGEST',
      });

      const setResponse = await mutatePreferences(
        {
          operation: 'SET_PREFERENCE',
          preference: {
            slug: 'system.response_length',
            value: '"brief"',
          },
        },
        defineOnlyHeaders,
        40,
      );
      const setResult = JSON.parse(setResponse.body.result.content[0].text);
      expect(setResponse.body.result?.isError).toBe(true);
      expect(setResult).toMatchObject({
        success: false,
        changed: false,
        code: 'MCP_PERMISSION_DENIED',
        requiredPermission: 'WRITE',
      });
    });

    it('should let WRITE token grants imply SUGGEST and READ but not DEFINE', async () => {
      const writeOnlyHeaders = mcpHeaders(TEST_CLIENT_IDS.claude, {
        'x-test-mcp-grants': 'preferences:write',
      });

      const suggestResponse = await mutatePreferences(
        {
          operation: 'SUGGEST_PREFERENCE',
          preference: {
            slug: 'system.response_tone',
            value: '"concise"',
            confidence: 0.9,
          },
        },
        writeOnlyHeaders,
        41,
      );
      expect(suggestResponse.status).toBe(200);
      expect(suggestResponse.body.result?.isError).not.toBe(true);

      const createResponse = await mutatePreferences(
        {
          operation: 'CREATE_DEFINITION',
          definition: {
            slug: 'token.write_cannot_define',
            description: 'WRITE token grants should not define schema',
            valueType: 'STRING',
            scope: 'GLOBAL',
          },
        },
        writeOnlyHeaders,
        42,
      );
      const createResult = JSON.parse(
        createResponse.body.result.content[0].text,
      );
      expect(createResponse.body.result?.isError).toBe(true);
      expect(createResult).toMatchObject({
        success: false,
        changed: false,
        code: 'MCP_PERMISSION_DENIED',
        requiredPermission: 'DEFINE',
      });
    });
  });

  describe('MCP resources', () => {
    it('should filter resources/list for unknown clients', async () => {
      const response = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 40,
          method: 'resources/list',
          params: {},
        },
        mcpHeaders(TEST_CLIENT_IDS.unknown),
      );

      expect(response.status).toBe(200);
      expect(response.body.result?.resources).toEqual([]);
    });

    it('should deny resources/read for unknown clients', async () => {
      const response = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 41,
          method: 'resources/read',
          params: { uri: 'schema://graphql' },
        },
        mcpHeaders(TEST_CLIENT_IDS.unknown),
      );

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('DCR routing', () => {
    it('should return the claude client for Claude callback URIs', async () => {
      const response = await request(app.getHttpServer())
        .post('/oauth/register')
        .set('Content-Type', 'application/json')
        .send({
          redirect_uris: ['http://localhost:8081/callback'],
        });

      expect(response.status).toBe(201);
      expect(response.body.client_id).toBe(TEST_CLIENT_IDS.claude);
    });

    it('should return the codex client for Codex callback URIs', async () => {
      const response = await request(app.getHttpServer())
        .post('/oauth/register')
        .set('Content-Type', 'application/json')
        .send({
          redirect_uris: ['http://127.0.0.1:8082/callback'],
        });

      expect(response.status).toBe(201);
      expect(response.body.client_id).toBe(TEST_CLIENT_IDS.codex);
    });

    it('should return the fallback client for supported fallback callback URIs', async () => {
      const response = await request(app.getHttpServer())
        .post('/oauth/register')
        .set('Content-Type', 'application/json')
        .send({
          redirect_uris: [
            'https://chatgpt.com/connector_platform_oauth_redirect',
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.client_id).toBe(TEST_CLIENT_IDS.fallback);
    });

    it('should reject mixed-bucket redirect URI sets', async () => {
      const response = await request(app.getHttpServer())
        .post('/oauth/register')
        .set('Content-Type', 'application/json')
        .send({
          redirect_uris: [
            'http://localhost:8081/callback',
            'http://127.0.0.1:8082/callback',
          ],
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /mcp', () => {
    it('should return 405 Method Not Allowed', async () => {
      const response = await request(app.getHttpServer()).get('/mcp');
      expect(response.status).toBe(405);
    });
  });

  describe('Origin validation', () => {
    it('should allow requests without an Origin header (non-browser clients)', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

      expect(response.status).not.toBe(403);
    });

    it('should allow requests from an allowed origin', async () => {
      // CORS_ORIGIN=http://localhost:3001 in .env.test, so allowedOrigins=['http://localhost:3001']
      const response = await mcpPost(
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { origin: 'http://localhost:3001' },
      );

      expect(response.status).not.toBe(403);
    });

    it('should reject requests from a disallowed origin', async () => {
      const response = await mcpPost(
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { origin: 'https://evil.example.com' },
      );

      expect(response.status).toBe(403);
    });
  });

  describe('listPreferenceSlugs user-awareness', () => {
    it('should include user-owned definitions for authenticated callers', async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);

      // Create a user-owned definition directly in DB
      await prisma.preferenceDefinition.create({
        data: {
          namespace: `USER:${testUser.userId}`,
          slug: 'custom.test_pref',
          description: 'A personal test preference',
          valueType: 'STRING',
          scope: 'GLOBAL',
          ownerUserId: testUser.userId,
        },
      });

      const response = await mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'listPreferenceSlugs', arguments: {} },
      });

      expect(response.status).toBe(200);
      const result = parseReadToolResult(response.body.result);
      const slugs = result.preferences.map((p: any) => p.slug);
      expect(slugs).toContain('custom.test_pref');
    });
  });

  describe('mutatePreferences operations', () => {
    beforeEach(async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);
    });

    it('should be included in tools/list', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });
      const toolNames = response.body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('mutatePreferences');
    });

    it('should create a new user-owned definition and return normalized shape', async () => {
      const response = await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'cooking.preferred_oil',
          description: 'Preferred cooking oil type',
          valueType: 'ENUM',
          scope: 'GLOBAL',
          displayName: 'Cooking Oil',
          options: ['olive', 'coconut', 'avocado'],
          isSensitive: false,
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.definition.slug).toBe('cooking.preferred_oil');
      expect(result.definition.category).toBe('cooking');
      expect(result.definition.valueType).toBe('ENUM');
      expect(result.definition.scope).toBe('GLOBAL');
      expect(result.definition.options).toEqual([
        'olive',
        'coconut',
        'avocado',
      ]);
      expect(result.definition.visibility).toBe('USER');
      expect(result.definition.id).toBeDefined();

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.DEFINITION_CREATED,
        },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        actorType: AuditActorType.MCP_CLIENT,
        actorClientKey: 'claude',
        origin: AuditOrigin.MCP,
      });
      expect(auditRows[0].correlationId).toBeTruthy();
    });

    it('should set and search profile preferences through the normal MCP surface', async () => {
      const setResponse = await mutatePreferences({
        operation: 'SET_PREFERENCE',
        preference: {
          slug: 'profile.full_name',
          value: '"Test Profile User"',
        },
      });

      expect(setResponse.status).toBe(200);
      const setResult = JSON.parse(setResponse.body.result.content[0].text);
      expect(setResult.success).toBe(true);
      expect(setResult.preference.slug).toBe('profile.full_name');

      const searchResponse = await mcpPost({
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: {
          name: 'searchPreferences',
          arguments: { query: 'profile' },
        },
      });

      expect(searchResponse.status).toBe(200);
      const searchResult = parseReadToolResult(searchResponse.body.result);
      expect(searchResult.active.preferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            slug: 'profile.full_name',
            value: 'Test Profile User',
          }),
        ]),
      );
    });

    it('should set an active preference with MCP provenance and inferred source', async () => {
      const response = await mutatePreferences(
        {
          operation: 'SET_PREFERENCE',
          preference: {
            slug: 'system.response_length',
            value: '"brief"',
            confidence: 0.87,
            evidence: { source: 'mcp-test', snippet: 'Keep replies brief' },
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.codex),
      );

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result).toMatchObject({
        success: true,
        changed: true,
        operation: 'SET_PREFERENCE',
        requiredPermission: 'WRITE',
      });
      expect(result.preference).toMatchObject({
        slug: 'system.response_length',
        value: 'brief',
        status: 'ACTIVE',
        sourceType: 'INFERRED',
        lastModifiedBy: {
          actorType: 'MCP_CLIENT',
          actorClientKey: 'codex',
          origin: 'MCP',
        },
        confidence: 0.87,
      });

      const stored = await prisma.preference.findUniqueOrThrow({
        where: { id: result.preference.id },
      });
      expect(stored).toMatchObject({
        lastActorType: AuditActorType.MCP_CLIENT,
        lastActorClientKey: 'codex',
        lastOrigin: AuditOrigin.MCP,
      });
      expect(stored.evidence).toEqual({
        source: 'mcp-test',
        snippet: 'Keep replies brief',
      });

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SET,
        },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        actorType: AuditActorType.MCP_CLIENT,
        actorClientKey: 'codex',
        origin: AuditOrigin.MCP,
      });
      expect(auditRows[0].correlationId).toBeTruthy();
    });

    it('should replace GraphQL last modifier with MCP client attribution and snapshot the transition', async () => {
      const setMutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            value
            lastModifiedBy {
              actorType
              actorClientKey
              origin
            }
          }
        }
      `;

      const graphqlResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: setMutation,
          variables: {
            input: {
              slug: 'system.response_length',
              value: 'brief',
            },
          },
        })
        .expect(200);

      expect(graphqlResponse.body.errors).toBeUndefined();
      expect(graphqlResponse.body.data.setPreference).toMatchObject({
        value: 'brief',
        lastModifiedBy: {
          actorType: 'USER',
          actorClientKey: null,
          origin: 'GRAPHQL',
        },
      });

      const mcpResponse = await mutatePreferences(
        {
          operation: 'SET_PREFERENCE',
          preference: {
            slug: 'system.response_length',
            value: '"detailed"',
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.codex),
      );

      expect(mcpResponse.status).toBe(200);
      const result = JSON.parse(mcpResponse.body.result.content[0].text);
      expect(result.preference).toMatchObject({
        id: graphqlResponse.body.data.setPreference.id,
        value: 'detailed',
        lastModifiedBy: {
          actorType: 'MCP_CLIENT',
          actorClientKey: 'codex',
          origin: 'MCP',
        },
      });

      const stored = await prisma.preference.findUniqueOrThrow({
        where: { id: graphqlResponse.body.data.setPreference.id },
      });
      expect(stored).toMatchObject({
        lastActorType: AuditActorType.MCP_CLIENT,
        lastActorClientKey: 'codex',
        lastOrigin: AuditOrigin.MCP,
      });

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SET,
        },
      });

      expect(auditRows).toHaveLength(2);
      const mcpAudit = auditRows.find(
        (auditRow) =>
          (auditRow.afterState as { value?: unknown } | null)?.value ===
          'detailed',
      );

      expect(mcpAudit).toBeDefined();
      expect(mcpAudit?.beforeState).toMatchObject({
        value: 'brief',
        lastModifiedBy: {
          actorType: 'USER',
          actorClientKey: null,
          origin: 'GRAPHQL',
        },
      });
      expect(mcpAudit?.afterState).toMatchObject({
        value: 'detailed',
        lastModifiedBy: {
          actorType: 'MCP_CLIENT',
          actorClientKey: 'codex',
          origin: 'MCP',
        },
      });
    });

    it.each([
      ['JSON string', '{"source":"ticket"}'],
      ['array', [{ source: 'ticket' }]],
      ['null', null],
    ])('should reject %s evidence payloads', async (_label, evidence) => {
      const response = await mutatePreferences({
        operation: 'SET_PREFERENCE',
        preference: {
          slug: 'system.response_length',
          value: '"brief"',
          evidence,
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.result?.isError).toBe(true);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result).toMatchObject({
        success: false,
        changed: false,
        code: 'INVALID_MUTATION_INPUT',
        error: 'preference.evidence must be a structured object',
      });
    });

    it('should update and archive a user-owned definition, then reject archived updates', async () => {
      const createResponse = await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'cooking.pan_material',
          description: 'Preferred pan material',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      });
      const created = JSON.parse(createResponse.body.result.content[0].text);
      const definitionId = created.definition.id;

      const updateResponse = await mutatePreferences({
        operation: 'UPDATE_DEFINITION',
        definition: {
          id: definitionId,
          displayName: 'Pan Material',
          description: 'Preferred cookware material',
          valueType: 'ENUM',
          scope: 'GLOBAL',
          options: ['cast_iron', 'stainless_steel'],
        },
      });
      const updated = JSON.parse(updateResponse.body.result.content[0].text);
      expect(updated).toMatchObject({
        success: true,
        changed: true,
        operation: 'UPDATE_DEFINITION',
        requiredPermission: 'DEFINE',
      });
      expect(updated.definition).toMatchObject({
        id: definitionId,
        displayName: 'Pan Material',
        valueType: 'ENUM',
      });

      const archiveResponse = await mutatePreferences({
        operation: 'ARCHIVE_DEFINITION',
        definition: { id: definitionId },
      });
      const archived = JSON.parse(archiveResponse.body.result.content[0].text);
      expect(archived).toMatchObject({
        success: true,
        changed: true,
        operation: 'ARCHIVE_DEFINITION',
        requiredPermission: 'DEFINE',
      });
      expect(archived.definition.archivedAt).toBeTruthy();

      const rejectedUpdateResponse = await mutatePreferences({
        operation: 'UPDATE_DEFINITION',
        definition: {
          id: definitionId,
          description: 'Should not update archived definitions',
        },
      });
      const rejectedUpdate = JSON.parse(
        rejectedUpdateResponse.body.result.content[0].text,
      );
      expect(rejectedUpdate).toMatchObject({
        success: false,
        changed: false,
        code: 'PREFERENCE_DEFINITION_ARCHIVED',
      });

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: {
            in: [
              AuditEventType.DEFINITION_CREATED,
              AuditEventType.DEFINITION_UPDATED,
              AuditEventType.DEFINITION_ARCHIVED,
            ],
          },
        },
      });
      expect(auditRows.map((row) => row.eventType).sort()).toEqual([
        AuditEventType.DEFINITION_ARCHIVED,
        AuditEventType.DEFINITION_CREATED,
        AuditEventType.DEFINITION_UPDATED,
      ]);
      for (const row of auditRows) {
        expect(row).toMatchObject({
          actorType: AuditActorType.MCP_CLIENT,
          actorClientKey: 'claude',
          origin: AuditOrigin.MCP,
        });
        expect(row.correlationId).toBeTruthy();
      }
    });

    it('should reject global-only definitions when updating or archiving by slug', async () => {
      for (const operation of [
        'UPDATE_DEFINITION',
        'ARCHIVE_DEFINITION',
      ] as const) {
        const response = await mutatePreferences({
          operation,
          definition: {
            slug: 'food.dietary_restrictions',
            description: 'Should not mutate global definitions',
          },
        });
        const result = JSON.parse(response.body.result.content[0].text);
        expect(response.body.result?.isError).toBe(true);
        expect(result).toMatchObject({
          success: false,
          changed: false,
          code: 'PREFERENCE_DEFINITION_NOT_OWNED',
          requiredPermission: 'DEFINE',
          target: 'food.dietary_restrictions',
        });
      }
    });

    it('should not resolve another user definition by slug for update/archive', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: 'other-definition-owner@example.com',
        },
      });
      await prisma.preferenceDefinition.create({
        data: {
          namespace: `USER:${otherUser.userId}`,
          ownerUserId: otherUser.userId,
          slug: 'private.other_user_definition',
          description: 'Definition owned by another user',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      });

      const response = await mutatePreferences({
        operation: 'UPDATE_DEFINITION',
        definition: {
          slug: 'private.other_user_definition',
          description: 'Should not update definitions owned by another user',
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(response.body.result?.isError).toBe(true);
      expect(result).toMatchObject({
        success: false,
        changed: false,
        code: 'PREFERENCE_DEFINITION_NOT_FOUND',
        requiredPermission: 'DEFINE',
        target: 'private.other_user_definition',
      });
    });

    it('should reject a duplicate user slug', async () => {
      const args = {
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'cooking.unique_slug',
          description: 'First',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      };
      await mutatePreferences(args);

      const response = await mutatePreferences(args, {}, 2);

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('PREFERENCE_DEFINITION_CONFLICT');
    });

    it('should reject a collision with an active global slug', async () => {
      const response = await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'food.dietary_restrictions', // seeded GLOBAL slug
          description: 'Duplicate global',
          valueType: 'ARRAY',
          scope: 'GLOBAL',
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('PREFERENCE_DEFINITION_CONFLICT');
    });

    it('should reject an invalid slug format', async () => {
      const response = await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'INVALID SLUG!',
          description: 'Bad slug',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PREFERENCE_DEFINITION');
    });

    it('should reject ENUM type with missing options', async () => {
      const response = await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'test.enum_no_opts',
          description: 'Enum without options',
          valueType: 'ENUM',
          scope: 'GLOBAL',
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PREFERENCE_DEFINITION');
    });

    it('should reject options supplied for non-ENUM type', async () => {
      const response = await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'test.bool_with_opts',
          description: 'Boolean with options',
          valueType: 'BOOLEAN',
          scope: 'GLOBAL',
          options: ['yes', 'no'],
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PREFERENCE_DEFINITION');
    });

    it('should not expose definition to another user via listPreferenceSlugs', async () => {
      const prisma = getPrismaClient();

      const userB = await prisma.user.create({
        data: {
          email: 'user-b-def@example.com',
        },
      });

      // Create definition as testUser
      await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'private.user_a_only',
          description: 'Only for user A',
          valueType: 'STRING',
          scope: 'GLOBAL',
        },
      });

      // List slugs as userB
      registerMcpUser(userB as any);
      const response = await mcpPost(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'listPreferenceSlugs', arguments: {} },
        },
        { 'x-test-user-id': userB.userId },
      );

      const result = parseReadToolResult(response.body.result);
      const slugs = result.preferences.map((p: any) => p.slug);
      expect(slugs).not.toContain('private.user_a_only');
    });

    it('should allow SUGGEST_PREFERENCE after CREATE_DEFINITION', async () => {
      // Create the definition
      await mutatePreferences({
        operation: 'CREATE_DEFINITION',
        definition: {
          slug: 'cooking.spice_level',
          description: 'Preferred spice level',
          valueType: 'ENUM',
          scope: 'GLOBAL',
          options: ['mild', 'medium', 'hot'],
        },
      });

      // Now suggest a value for it
      const response = await mutatePreferences(
        {
          operation: 'SUGGEST_PREFERENCE',
          preference: {
            slug: 'cooking.spice_level',
            value: '"hot"',
            confidence: 0.8,
          },
        },
        {},
        2,
      );

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.preference.slug).toBe('cooking.spice_level');
    });

    it('should return an explicit suppressed no-op when a suggestion was already rejected', async () => {
      const suggestResponse = await mutatePreferences({
        operation: 'SUGGEST_PREFERENCE',
        preference: {
          slug: 'communication.preferred_channels',
          value: '["email"]',
          confidence: 0.7,
        },
      });
      const suggestion = JSON.parse(
        suggestResponse.body.result.content[0].text,
      );

      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation RejectSuggestion($id: ID!) {
              rejectSuggestedPreference(id: $id)
            }
          `,
          variables: { id: suggestion.preference.id },
        })
        .expect(200);

      const resuggestResponse = await mutatePreferences({
        operation: 'SUGGEST_PREFERENCE',
        preference: {
          slug: 'communication.preferred_channels',
          value: '["email"]',
          confidence: 0.95,
        },
      });
      const result = JSON.parse(resuggestResponse.body.result.content[0].text);
      expect(result).toMatchObject({
        success: true,
        changed: false,
        code: 'SUGGESTION_SUPPRESSED',
        preference: null,
      });

      expect(
        await prisma.preferenceAuditEvent.count({
          where: {
            userId: testUser.userId,
            eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
          },
        }),
      ).toBe(1);
    });

    it('should record MCP actor provenance for DELETE_PREFERENCE', async () => {
      const createResponse = await request(app.getHttpServer())
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
              slug: 'system.response_length',
              value: 'brief',
            },
          },
        })
        .expect(200);

      const preferenceId = createResponse.body.data.setPreference.id;

      const response = await mutatePreferences(
        {
          operation: 'DELETE_PREFERENCE',
          preference: {
            id: preferenceId,
          },
        },
        mcpHeaders(TEST_CLIENT_IDS.codex),
        52,
      );

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.preference.id).toBe(preferenceId);

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_DELETED,
        },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        actorType: AuditActorType.MCP_CLIENT,
        actorClientKey: 'codex',
        origin: AuditOrigin.MCP,
      });
      expect(auditRows[0].correlationId).toBeTruthy();
      expect(auditRows[0].beforeState).toMatchObject({
        id: preferenceId,
        slug: 'system.response_length',
        value: 'brief',
      });
      expect(auditRows[0].afterState).toBeNull();
    });

    it('should return structured guidance when slug is unknown', async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);

      const response = await mutatePreferences({
        operation: 'SUGGEST_PREFERENCE',
        preference: {
          slug: 'nonexistent.slug_that_does_not_exist',
          value: '"some value"',
          confidence: 0.9,
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined(); // backward compat: error field always present
      expect(result.code).toBe('UNKNOWN_PREFERENCE_SLUG');
      expect(result.changed).toBe(false);
    });
  });

  describe('Concurrent request isolation', () => {
    it('should scope searchPreferences results to the authenticated user', async () => {
      const prisma = getPrismaClient();

      // Seed preference definitions (required FK)
      await seedPreferenceDefinitions(prisma);

      // userA is the test user already created in beforeEach
      const userA = testUser;
      const userB = await prisma.user.create({
        data: {
          email: 'user-b@example.com',
        },
      });

      registerMcpUser(userA);
      registerMcpUser(userB);

      // Find two preference definitions to use as unique slugs
      const defA = await prisma.preferenceDefinition.findFirst({
        where: { slug: 'food.dietary_restrictions' },
      });
      const defB = await prisma.preferenceDefinition.findFirst({
        where: { slug: 'food.cuisine_preferences' },
      });

      expect(defA).toBeDefined();
      expect(defB).toBeDefined();

      // Seed one preference per user with a distinct value
      const uniqueValueA = 'unique-value-for-user-a';
      const uniqueValueB = 'unique-value-for-user-b';

      await prisma.preference.create({
        data: {
          userId: userA.userId,
          definitionId: defA!.id,
          contextKey: 'GLOBAL',
          value: JSON.stringify(uniqueValueA),
          status: 'ACTIVE',
          sourceType: 'USER',
        },
      });

      await prisma.preference.create({
        data: {
          userId: userB.userId,
          definitionId: defB!.id,
          contextKey: 'GLOBAL',
          value: JSON.stringify(uniqueValueB),
          status: 'ACTIVE',
          sourceType: 'USER',
        },
      });

      // Spy on Server.prototype.setRequestHandler to wrap the CallToolRequestSchema
      // handler. The barrier fires at the START of the handler — before any context
      // is read — ensuring both requests are simultaneously in-flight before either
      // resolves. This test would fail against the old singleton-context implementation
      // because both paused handlers would race on getContext() after the barrier lifts.
      const originalSetRequestHandler = Server.prototype.setRequestHandler;
      let resolveBarrier: () => void;
      const barrier = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
      });
      let inflightCount = 0;

      const setRequestHandlerSpy = jest
        .spyOn(Server.prototype, 'setRequestHandler')
        .mockImplementation(function (this: Server, schema: any, handler: any) {
          if (schema === CallToolRequestSchema) {
            const wrappedHandler = async (...args: any[]) => {
              inflightCount++;
              if (inflightCount === 2) {
                // Both handlers are now in-flight — release the barrier
                resolveBarrier();
              }
              await barrier;
              return handler.apply(this, args);
            };
            return originalSetRequestHandler.call(this, schema, wrappedHandler);
          }
          return originalSetRequestHandler.call(this, schema, handler);
        });

      const mcpRequest = (userId: string) =>
        mcpPost(
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'searchPreferences', arguments: {} },
          },
          { 'x-test-user-id': userId },
        );

      const [responseA, responseB] = await Promise.all([
        mcpRequest(userA.userId),
        mcpRequest(userB.userId),
      ]);

      setRequestHandlerSpy.mockRestore();

      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);

      const textA = JSON.stringify(parseReadToolResult(responseA.body.result));
      const textB = JSON.stringify(parseReadToolResult(responseB.body.result));

      // User A's response contains A's value and not B's
      expect(textA).toContain(uniqueValueA);
      expect(textA).not.toContain(uniqueValueB);

      // User B's response contains B's value and not A's
      expect(textB).toContain(uniqueValueB);
      expect(textB).not.toContain(uniqueValueA);
    });
  });
});
