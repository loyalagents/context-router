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
