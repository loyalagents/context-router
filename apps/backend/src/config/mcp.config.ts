import { registerAs } from '@nestjs/config';
import { McpClientConfig } from '../mcp/types/mcp-authorization.types';
import {
  normalizeOriginList,
  resolveCorsOrigins,
  type RuntimeConfiguration,
  type RuntimeEnvironment,
} from './runtime-config';

export function createMcpConfiguration(
  environment: RuntimeEnvironment = process.env,
  defaultAllowedOrigins: string[] = resolveCorsOrigins(environment),
) {
  const auth0Issuer = environment.AUTH0_ISSUER;
  const auth0Audience = environment.AUTH0_AUDIENCE;
  const serverUrl = environment.MCP_SERVER_URL;
  const httpPath = environment.MCP_HTTP_PATH || '/mcp';
  const normalizedHttpPath = httpPath.startsWith('/')
    ? httpPath
    : `/${httpPath}`;
  const protectedResource =
    environment.MCP_RESOURCE ||
    (serverUrl
      ? new URL(normalizedHttpPath, serverUrl).toString()
      : auth0Audience);

  const authorizationEndpoint = auth0Issuer
    ? new URL('authorize', auth0Issuer)
    : undefined;
  if (authorizationEndpoint && auth0Audience) {
    authorizationEndpoint.searchParams.set('audience', auth0Audience);
  }

  const clients: McpClientConfig[] = [
    {
      key: 'claude',
      label: 'Claude',
      capabilities: [
        'preferences:read',
        'preferences:suggest',
        'preferences:write',
        'preferences:define',
      ],
      targetRules: [],
      oauth: {
        clientId: environment.AUTH0_MCP_CLAUDE_CLIENT_ID,
        redirectUris: [
          'https://claude.ai/api/mcp/auth_callback',
          'https://claude.com/api/mcp/auth_callback',
          'https://claude.ai/oauth/callback',
          'https://claude.com/oauth/callback',
          'https://claude.ai/api/oauth/callback',
          'https://claude.com/api/oauth/callback',
          'http://localhost:8081/callback',
        ],
      },
    },
    {
      key: 'codex',
      label: 'Codex',
      capabilities: [
        'preferences:read',
        'preferences:suggest',
        'preferences:write',
        'preferences:define',
      ],
      targetRules: [],
      oauth: {
        clientId: environment.AUTH0_MCP_CODEX_CLIENT_ID,
        redirectUris: ['http://127.0.0.1:8082/callback'],
      },
    },
    {
      key: 'fallback',
      label: 'Supported Fallback',
      capabilities: ['preferences:read'],
      targetRules: [],
      oauth: {
        clientId:
          environment.AUTH0_MCP_FALLBACK_CLIENT_ID ||
          environment.AUTH0_MCP_PUBLIC_CLIENT_ID,
        redirectUris: [
          'https://chatgpt.com/connector_platform_oauth_redirect',
          'https://platform.openai.com/apps-manage/oauth',
        ],
      },
    },
    {
      key: 'unknown',
      label: 'Unknown',
      capabilities: [],
      targetRules: [],
    },
  ];

  return {
    // Server Identity
    server: {
      name: 'context-router-mcp',
      version: '2.0.1',
      description: 'MCP server for user preferences management',
    },

    // HTTP Transport Configuration
    httpTransport: {
      enabled: environment.MCP_HTTP_ENABLED !== 'false', // Enabled by default
      path: httpPath,
      requireAuth: environment.MCP_HTTP_REQUIRE_AUTH !== 'false', // JWT required by default
      allowedOrigins:
        normalizeOriginList(
          environment.MCP_HTTP_ALLOWED_ORIGINS,
          'MCP_HTTP_ALLOWED_ORIGINS',
        ) ?? defaultAllowedOrigins,
    },

    // Stdio Transport Configuration
    stdioTransport: {
      enabled: environment.MCP_STDIO_ENABLED === 'true', // Disabled by default (enable for local dev)
    },

    // Feature Configuration
    tools: {
      preferences: {
        enabled: environment.MCP_TOOLS_PREFERENCES_ENABLED !== 'false',
        maxSearchResults: parseInt(
          environment.MCP_TOOLS_PREFERENCES_MAX_SEARCH_RESULTS || '100',
          10,
        ),
      },
    },

    resources: {
      schema: {
        enabled: environment.MCP_RESOURCES_SCHEMA_ENABLED !== 'false',
      },
    },

    // OAuth Configuration for MCP clients (Claude, ChatGPT)
    oauth: {
      // The protected resource identifier exposed to MCP clients. Claude expects
      // this to match the MCP URL or origin, not the Auth0 API audience.
      resource: protectedResource,

      // The public-facing server URL (used for registration_endpoint in OAuth metadata)
      // This must be the actual URL where the server is accessible, not the Auth0 audience
      serverUrl,

      // The canonical issuer owns all hosted OAuth/JWKS endpoints.
      auth0: {
        authorizationEndpoint: authorizationEndpoint?.toString(),
        tokenEndpoint: auth0Issuer
          ? new URL('oauth/token', auth0Issuer).toString()
          : undefined,
        jwksUri: auth0Issuer
          ? new URL('.well-known/jwks.json', auth0Issuer).toString()
          : undefined,
      },

      // Scopes supported by MCP tools
      scopes: [
        'preferences:read',
        'preferences:suggest',
        'preferences:write',
        'preferences:define',
        'offline_access',
      ],

      // Rate limiting for /oauth/register
      rateLimit: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: parseInt(
          environment.MCP_OAUTH_REGISTER_RATE_LIMIT || '30',
          10,
        ),
      },
    },

    clients,
  };
}

export function mcpConfigLoader(configuration: RuntimeConfiguration) {
  return registerAs('mcp', () =>
    createMcpConfiguration(process.env, configuration.corsOrigins),
  );
}

export default registerAs('mcp', () => createMcpConfiguration());
