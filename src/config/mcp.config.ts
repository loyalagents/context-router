import { registerAs } from '@nestjs/config';

export default registerAs('mcp', () => ({
  // Server Identity
  server: {
    name: 'context-router-mcp',
    version: '1.0.0',
    description: 'MCP server for user preferences management',
  },

  // HTTP Transport Configuration
  httpTransport: {
    enabled: process.env.MCP_HTTP_ENABLED !== 'false', // Enabled by default
    path: process.env.MCP_HTTP_PATH || '/mcp',
    requireAuth: process.env.MCP_HTTP_REQUIRE_AUTH !== 'false', // JWT required by default
    allowedOrigins: process.env.MCP_HTTP_ALLOWED_ORIGINS
      ? process.env.MCP_HTTP_ALLOWED_ORIGINS.split(',')
      : ['*'], // CORS origins for AI clients
  },

  // Stdio Transport Configuration
  stdioTransport: {
    enabled: process.env.MCP_STDIO_ENABLED === 'true', // Disabled by default (enable for local dev)
  },

  // Feature Configuration
  tools: {
    preferences: {
      enabled: process.env.MCP_TOOLS_PREFERENCES_ENABLED !== 'false',
      maxSearchResults: parseInt(
        process.env.MCP_TOOLS_PREFERENCES_MAX_SEARCH_RESULTS || '100',
        10,
      ),
    },
  },

  resources: {
    schema: {
      enabled: process.env.MCP_RESOURCES_SCHEMA_ENABLED !== 'false',
    },
  },
}));
