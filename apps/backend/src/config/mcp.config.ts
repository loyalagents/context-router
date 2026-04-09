import { registerAs } from '@nestjs/config';
import { McpClientConfig } from '../mcp/types/mcp-authorization.types';

export default registerAs('mcp', () => {
  const clients: McpClientConfig[] = [
    {
      key: 'claude',
      label: 'Claude',
      capabilities: ['preferences:read', 'preferences:write'],
      targetRules: [],
    },
    {
      key: 'codex',
      label: 'Codex',
      capabilities: ['preferences:read'],
      targetRules: [],
    },
    {
      key: 'fallback',  
      label: 'Fallback',
      capabilities: ['preferences:read'],
      targetRules: [],
    },
    {
      key: 'unknown',
      label: 'Unknown',
      capabilities: [],
      targetRules: [],
    },
  ];
  return {
    server: {
      name: 'context-router-mcp',
      version: '1.0.0',
      description: 'MCP server for user preferences management',
    },
    httpTransport: {
      enabled: process.env.MCP_HTTP_ENABLED !== 'false',
      path: process.env.MCP_HTTP_PATH || '/mcp',
      requireAuth: process.env.MCP_HTTP_REQUIRE_AUTH !== 'false',
      allowedOrigins: process.env.MCP_HTTP_ALLOWED_ORIGINS
        ? process.env.MCP_HTTP_ALLOWED_ORIGINS.split(',')
        : process.env.CORS_ORIGIN
          ? process.env.CORS_ORIGIN.split(',')
          : [
              'http://localhost:3000',
              'http://localhost:3001',
              'http://localhost:3002',
              'http://127.0.0.1:3002',
            ],
    },
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
    clients,
  };
});
