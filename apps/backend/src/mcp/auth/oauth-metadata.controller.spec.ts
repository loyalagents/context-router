import { ConfigService } from '@nestjs/config';
import { OAuthMetadataController } from './oauth-metadata.controller';

describe('OAuthMetadataController', () => {
  const configValues: Record<string, unknown> = {
    'mcp.oauth.resource': 'http://localhost:3001/mcp',
    'mcp.oauth.serverUrl': 'http://localhost:3001',
    'mcp.oauth.auth0.authorizationEndpoint':
      'https://example.us.auth0.com/authorize?audience=https%3A%2F%2Fcontext-router-api',
    'mcp.oauth.auth0.tokenEndpoint':
      'https://example.us.auth0.com/oauth/token',
    'mcp.oauth.auth0.jwksUri':
      'https://example.us.auth0.com/.well-known/jwks.json',
    'mcp.oauth.scopes': [
      'preferences:read',
      'preferences:suggest',
      'preferences:write',
      'preferences:define',
      'offline_access',
    ],
  };

  const createController = () => {
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    return new OAuthMetadataController(configService);
  };

  it('advertises the public MCP server URL as the authorization server issuer', () => {
    const controller = createController();

    expect(controller.getProtectedResourceMetadata()).toMatchObject({
      resource: 'http://localhost:3001/mcp',
      authorization_servers: ['http://localhost:3001'],
    });
  });

  it('uses the public MCP server URL as the discovery issuer', () => {
    const controller = createController();

    expect(controller.getAuthorizationServerMetadata()).toMatchObject({
      issuer: 'http://localhost:3001',
      authorization_endpoint:
        'https://example.us.auth0.com/authorize?audience=https%3A%2F%2Fcontext-router-api',
      token_endpoint: 'https://example.us.auth0.com/oauth/token',
      registration_endpoint: 'http://localhost:3001/oauth/register',
    });
  });
});
