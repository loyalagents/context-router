import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
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
  let mcpService: McpService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    mcpService = moduleFixture.get<McpService>(McpService);
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
      const configService = app.get('ConfigService');
      const mcpConfig = configService.get('mcp');

      expect(mcpConfig).toBeDefined();
      expect(mcpConfig.server).toBeDefined();
      expect(mcpConfig.server.name).toBe('context-router-mcp');
      expect(mcpConfig.server.version).toBe('1.0.0');
    });

    it('should have HTTP transport enabled by default', () => {
      const configService = app.get('ConfigService');
      const httpTransport = configService.get('mcp.httpTransport');

      expect(httpTransport).toBeDefined();
      expect(httpTransport.enabled).toBe(true);
      expect(httpTransport.path).toBe('/mcp');
    });
  });

  /**
   * TODO: Add integration tests for:
   * 1. tools/list - Verify all 4 preference tools are registered
   * 2. tools/call - Test each tool with mock data
   * 3. resources/list - Verify GraphQL schema resource is available
   * 4. resources/read - Test GraphQL schema retrieval
   *
   * These tests require creating an MCP client connection,
   * which is complex in a unit test environment.
   * Consider using the MCP Inspector for manual testing:
   * npx @modelcontextprotocol/inspector npm run start:dev
   */
});
