import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { McpAuthGuard } from './mcp-auth.guard';
import { AuthService } from '@/modules/auth/auth.service';

describe('McpAuthGuard', () => {
  const configValues: Record<string, unknown> = {
    'auth.auth0.domain': 'example.us.auth0.com',
    'auth.auth0.issuer': 'https://example.us.auth0.com/',
    'auth.auth0.audience': 'https://context-router-api',
    'mcp.oauth.resource': 'https://context-router-api',
    'mcp.oauth.serverUrl': 'http://localhost:3001',
  };

  const createGuard = () => {
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    return new McpAuthGuard(configService, {} as AuthService);
  };

  const createContext = (headers: Record<string, string> = {}) => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    const request = { headers };

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    return { context, response };
  };

  it('uses the public MCP server URL for OAuth discovery challenges', async () => {
    const guard = createGuard();
    const { context, response } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(false);

    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining(
        'resource_metadata="http://localhost:3001/.well-known/oauth-protected-resource"',
      ),
    );
  });

  it('uses the public MCP server URL for insufficient-scope challenges', () => {
    const guard = createGuard();
    const { response } = createContext();

    guard.sendInsufficientScopeChallenge(response as any, 'preferences:write');

    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining(
        'resource_metadata="http://localhost:3001/.well-known/oauth-protected-resource"',
      ),
    );
  });
});
