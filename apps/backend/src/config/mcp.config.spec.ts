import mcpConfig from './mcp.config';

describe('mcpConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MCP_SERVER_URL = 'http://localhost:3001';
    process.env.AUTH0_AUDIENCE = 'https://context-router-api';
    process.env.AUTH0_DOMAIN = 'example.us.auth0.com';
    process.env.AUTH0_ISSUER = 'https://example.us.auth0.com/';
    delete process.env.MCP_RESOURCE;
    delete process.env.MCP_HTTP_PATH;
    delete process.env.MCP_HTTP_ALLOWED_ORIGINS;
    delete process.env.CORS_ORIGIN;
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

  it('uses the explicit issuer for authorization endpoints and the domain only for JWKS', () => {
    delete process.env.AUTH0_ISSUER;

    const config = mcpConfig();

    expect(config.oauth.auth0.authorizationEndpoint).toBeUndefined();
    expect(config.oauth.auth0.tokenEndpoint).toBeUndefined();
    expect(config.oauth.auth0.jwksUri).toBe(
      'https://example.us.auth0.com/.well-known/jwks.json',
    );
  });

  it('inherits the normalized CORS origins unless the MCP override wins', () => {
    process.env.CORS_ORIGIN =
      ' https://one.example,https://two.example, https://one.example ';

    expect(mcpConfig().httpTransport.allowedOrigins).toEqual([
      'https://one.example',
      'https://two.example',
    ]);

    process.env.MCP_HTTP_ALLOWED_ORIGINS = 'https://mcp.example';
    expect(mcpConfig().httpTransport.allowedOrigins).toEqual([
      'https://mcp.example',
    ]);
  });
});
