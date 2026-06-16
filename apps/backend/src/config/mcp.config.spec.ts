import mcpConfig from './mcp.config';

describe('mcpConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MCP_SERVER_URL = 'http://localhost:3001';
    process.env.AUTH0_AUDIENCE = 'https://context-router-api';
    process.env.AUTH0_DOMAIN = 'example.us.auth0.com';
    delete process.env.MCP_RESOURCE;
    delete process.env.MCP_HTTP_PATH;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the MCP endpoint URL as the protected resource identifier', () => {
    const config = mcpConfig();

    expect(config.oauth.resource).toBe('http://localhost:3001/mcp');
  });

  it('keeps Auth0 authorization requests targeted at the API audience', () => {
    const config = mcpConfig();

    expect(config.oauth.auth0.authorizationEndpoint).toBe(
      'https://example.us.auth0.com/authorize?audience=https%3A%2F%2Fcontext-router-api',
    );
  });
});
