import { registerAs } from '@nestjs/config';

export default registerAs('mcp', () => {
  const auth0Domain = process.env.AUTH0_DOMAIN;

  return {
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

    // OAuth Configuration for MCP clients (Claude, ChatGPT)
    oauth: {
      // The resource identifier - must match Auth0 API identifier and token audience
      // TODO: Consider separating MCP_RESOURCE from AUTH0_AUDIENCE in the future if:
      // - We move to a custom domain (MCP_RESOURCE = custom domain, AUTH0_AUDIENCE = API identifier)
      // - We want to hide Auth0 internals from OAuth metadata
      // For now, using AUTH0_AUDIENCE directly is simpler and avoids mismatch issues.
      resource: process.env.AUTH0_AUDIENCE,

      // The public-facing server URL (used for registration_endpoint in OAuth metadata)
      // This must be the actual URL where the server is accessible, not the Auth0 audience
      serverUrl: process.env.MCP_SERVER_URL,

      // Auth0 endpoints (derived from AUTH0_DOMAIN)
      auth0: {
        domain: auth0Domain,
        authorizationEndpoint: auth0Domain
          ? `https://${auth0Domain}/authorize`
          : undefined,
        tokenEndpoint: auth0Domain
          ? `https://${auth0Domain}/oauth/token`
          : undefined,
        jwksUri: auth0Domain
          ? `https://${auth0Domain}/.well-known/jwks.json`
          : undefined,
      },

      // Pre-registered public client_id for MCP connectors (PKCE, no secret)
      publicClientId: process.env.AUTH0_MCP_PUBLIC_CLIENT_ID,

      // Scopes supported by MCP tools
      scopes: ['preferences:read', 'preferences:write', 'offline_access'],

      // Allowed redirect URIs for DCR shim (strict allowlist)
      // Note: Claude Desktop uses http://localhost or http://127.0.0.1 with dynamic ports
      allowedRedirectUris: [
        // ChatGPT web
        'https://chatgpt.com/connector_platform_oauth_redirect',
        // Claude web and desktop (various possible patterns)
        'https://claude.ai/api/mcp/auth_callback',
        'https://claude.com/api/mcp/auth_callback',
        'https://claude.ai/oauth/callback',
        'https://claude.com/oauth/callback',
        'https://claude.ai/api/oauth/callback',
        'https://claude.com/api/oauth/callback',
        // Claude Desktop (uses localhost with various ports)
        'http://localhost/callback',
        'http://127.0.0.1/callback',
      ],

      // Rate limiting for /oauth/register
      rateLimit: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: parseInt(
          process.env.MCP_OAUTH_REGISTER_RATE_LIMIT || '30',
          10,
        ),
      },
    },
  };
});
