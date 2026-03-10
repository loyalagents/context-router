import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { McpService } from '../../src/mcp/mcp.service';
import { getPrismaClient, seedPreferenceDefinitions } from '../setup/test-db';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('MCP Integration (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let registerMcpUser: (user: TestUser) => void;
  let mcpService: McpService;
  let configService: ConfigService;

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

  describe('MCP Service', () => {
    it('should be defined', () => {
      expect(mcpService).toBeDefined();
    });

    it('should create a distinct server per call', () => {
      const context = { user: testUser };
      const serverA = mcpService.createServer(context);
      const serverB = mcpService.createServer(context);
      expect(serverA).not.toBe(serverB);
    });
  });

  describe('MCP Configuration', () => {
    it('should load MCP configuration', () => {
      const mcpConfig = configService.get('mcp');

      expect(mcpConfig).toBeDefined();
      expect(mcpConfig.server).toBeDefined();
      expect(mcpConfig.server.name).toBe('context-router-mcp');
      expect(mcpConfig.server.version).toBe('1.0.0');
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
      const resourcesEnabled = configService.get('mcp.resources.schema.enabled');
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
      const toolNames = response.body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('searchPreferences');
      expect(toolNames).toContain('listPreferenceSlugs');
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
      const result = JSON.parse(response.body.result.content[0].text);
      const slugs = result.preferences.map((p: any) => p.slug);
      expect(slugs).toContain('custom.test_pref');
    });
  });

  describe('createPreferenceDefinition', () => {
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
      expect(toolNames).toContain('createPreferenceDefinition');
    });

    it('should create a new user-owned definition and return normalized shape', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'createPreferenceDefinition',
          arguments: {
            slug: 'cooking.preferred_oil',
            description: 'Preferred cooking oil type',
            valueType: 'ENUM',
            scope: 'GLOBAL',
            displayName: 'Cooking Oil',
            options: ['olive', 'coconut', 'avocado'],
            isSensitive: false,
          },
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.definition.slug).toBe('cooking.preferred_oil');
      expect(result.definition.category).toBe('cooking');
      expect(result.definition.valueType).toBe('ENUM');
      expect(result.definition.scope).toBe('GLOBAL');
      expect(result.definition.options).toEqual(['olive', 'coconut', 'avocado']);
      expect(result.definition.visibility).toBe('USER');
      expect(result.definition.id).toBeDefined();
    });

    it('should reject a duplicate user slug', async () => {
      const args = {
        slug: 'cooking.unique_slug',
        description: 'First',
        valueType: 'STRING',
        scope: 'GLOBAL',
      };
      await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'createPreferenceDefinition', arguments: args },
      });

      const response = await mcpPost({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'createPreferenceDefinition', arguments: args },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('PREFERENCE_DEFINITION_CONFLICT');
    });

    it('should reject a collision with an active global slug', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'createPreferenceDefinition',
          arguments: {
            slug: 'food.dietary_restrictions', // seeded GLOBAL slug
            description: 'Duplicate global',
            valueType: 'ARRAY',
            scope: 'GLOBAL',
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('PREFERENCE_DEFINITION_CONFLICT');
    });

    it('should reject an invalid slug format', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'createPreferenceDefinition',
          arguments: {
            slug: 'INVALID SLUG!',
            description: 'Bad slug',
            valueType: 'STRING',
            scope: 'GLOBAL',
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PREFERENCE_DEFINITION');
    });

    it('should reject ENUM type with missing options', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'createPreferenceDefinition',
          arguments: {
            slug: 'test.enum_no_opts',
            description: 'Enum without options',
            valueType: 'ENUM',
            scope: 'GLOBAL',
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PREFERENCE_DEFINITION');
    });

    it('should reject options supplied for non-ENUM type', async () => {
      const response = await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'createPreferenceDefinition',
          arguments: {
            slug: 'test.bool_with_opts',
            description: 'Boolean with options',
            valueType: 'BOOLEAN',
            scope: 'GLOBAL',
            options: ['yes', 'no'],
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_PREFERENCE_DEFINITION');
    });

    it('should not expose definition to another user via listPreferenceSlugs', async () => {
      const prisma = getPrismaClient();

      const userB = await prisma.user.create({
        data: { email: 'user-b-def@example.com', firstName: 'User', lastName: 'B' },
      });

      // Create definition as testUser
      await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'createPreferenceDefinition',
          arguments: {
            slug: 'private.user_a_only',
            description: 'Only for user A',
            valueType: 'STRING',
            scope: 'GLOBAL',
          },
        },
      });

      // List slugs as userB
      registerMcpUser(userB as any);
      const response = await mcpPost(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'listPreferenceSlugs', arguments: {} } },
        { 'x-test-user-id': userB.userId },
      );

      const result = JSON.parse(response.body.result.content[0].text);
      const slugs = result.preferences.map((p: any) => p.slug);
      expect(slugs).not.toContain('private.user_a_only');
    });

    it('should allow suggestPreference after createPreferenceDefinition', async () => {
      // Create the definition
      await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'createPreferenceDefinition',
          arguments: {
            slug: 'cooking.spice_level',
            description: 'Preferred spice level',
            valueType: 'ENUM',
            scope: 'GLOBAL',
            options: ['mild', 'medium', 'hot'],
          },
        },
      });

      // Now suggest a value for it
      const response = await mcpPost({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'suggestPreference',
          arguments: {
            slug: 'cooking.spice_level',
            value: '"hot"',
            confidence: 0.8,
          },
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.preference.slug).toBe('cooking.spice_level');
    });
  });

  describe('suggestPreference unknown-slug structured error', () => {
    it('should return structured guidance when slug is unknown', async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);

      const response = await mcpPost({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'suggestPreference',
          arguments: {
            slug: 'nonexistent.slug_that_does_not_exist',
            value: '"some value"',
            confidence: 0.9,
          },
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNKNOWN_PREFERENCE_SLUG');
      expect(result.suggestedTool).toBe('createPreferenceDefinition');
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
          firstName: 'User',
          lastName: 'B',
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

      const textA = responseA.body.result?.content?.[0]?.text ?? '';
      const textB = responseB.body.result?.content?.[0]?.text ?? '';

      // User A's response contains A's value and not B's
      expect(textA).toContain(uniqueValueA);
      expect(textA).not.toContain(uniqueValueB);

      // User B's response contains B's value and not A's
      expect(textB).toContain(uniqueValueB);
      expect(textB).not.toContain(uniqueValueA);
    });
  });
});
