import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { McpService } from '../../src/mcp/mcp.service';

/**
 * E2E Tests for MCP Integration
 *
 * These tests verify the MCP server initialization and basic functionality.
 * For full integration testing with tool calls, use the MCP Inspector:
 * https://github.com/modelcontextprotocol/inspector
 *
 * Run with: npm run test:e2e
 */
describe('MCP Integration (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let mcpService: McpService;
  let configService: ConfigService;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    mcpService = testApp.module.get<McpService>(McpService);
    configService = testApp.module.get<ConfigService>(ConfigService);
  });

  beforeEach(async () => {
    // Create fresh user after resetDb()
    testUser = await createTestUser();
    setTestUser(testUser);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('MCP Server Initialization', () => {
    it('should initialize MCP service', () => {
      expect(mcpService).toBeDefined();
    });

    it('should have a server instance', () => {
      const server = mcpService.getServer();
      expect(server).toBeDefined();
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

  describe('MCP Context Management', () => {
    it('should set and retrieve context', () => {
      const context = { user: testUser };
      mcpService.setContext(context);

      const retrievedContext = mcpService.getContext();
      expect(retrievedContext).toEqual(context);
      expect(retrievedContext?.user.userId).toBe(testUser.userId);
    });

    it('should clear context', () => {
      const context = { user: testUser };
      mcpService.setContext(context);
      mcpService.clearContext();

      const retrievedContext = mcpService.getContext();
      expect(retrievedContext).toBeNull();
    });
  });
});
