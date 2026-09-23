import { ConfigService } from '@nestjs/config';
import { ExecutionContext, Logger } from '@nestjs/common';
import { McpAuthGuard } from './mcp-auth.guard';
import { AuthService } from '@/modules/auth/auth.service';
import { JwksClient } from 'jwks-rsa';
import { createHumanJwtFixture } from '../../../test/fixtures/human-jwt';

describe('McpAuthGuard', () => {
  const signed = createHumanJwtFixture(
    'https://example.us.auth0.com/',
    'https://context-router-api',
  );

  afterEach(() => jest.restoreAllMocks());

  function useFixtureKey(guard: McpAuthGuard) {
    const client = (guard as unknown as { jwksClient: JwksClient }).jwksClient;
    jest
      .spyOn(client, 'getSigningKey')
      .mockResolvedValue({ getPublicKey: () => signed.publicKey } as never);
  }
  const configValues: Record<string, unknown> = {
    'auth.auth0.issuer': 'https://example.us.auth0.com/',
    'auth.auth0.audience': 'https://context-router-api',
    'auth.auth0.jwksUri': 'https://example.us.auth0.com/.well-known/jwks.json',
    'mcp.oauth.resource': 'https://context-router-api',
    'mcp.oauth.serverUrl': 'http://localhost:3001',
  };

  const createGuard = (
    authService: Partial<AuthService> = {},
    identityResolver: { resolve?: jest.Mock } = {},
  ) => {
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    return new McpAuthGuard(
      configService,
      authService as AuthService,
      identityResolver as never,
    );
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

  it('authenticates a signed human JWT despite malformed optional hints', async () => {
    const existing = { userId: 'principal-existing' };
    const identityResolver = { resolve: jest.fn().mockResolvedValue(existing) };
    const guard = createGuard({}, identityResolver);
    useFixtureKey(guard);
    const { context, response } = createContext({
      authorization: `Bearer ${signed.token({
        name: 'Ada ',
        email: 'not an email',
        email_verified: false,
        given_name: 'Ada',
      })}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest().user).toBe(existing);
    expect(response.status).not.toHaveBeenCalled();
    expect(identityResolver.resolve).toHaveBeenCalledWith({
      key: {
        provider: 'auth0',
        issuer: 'https://example.us.auth0.com/',
        subject: 'auth0|human',
      },
      profileHints: { givenName: 'Ada' },
    });
  });

  it.each([
    ['issuer', { iss: 'https://other.example.test/' }],
    ['audience', { aud: 'wrong-audience' }],
    ['expiration', { exp: 1 }],
    ['subject', { sub: '' }],
    ['signature', {}],
  ])('rejects invalid %s before human resolution', async (reason, claims) => {
    const identityResolver = { resolve: jest.fn() };
    const guard = createGuard({}, identityResolver);
    useFixtureKey(guard);
    let token = signed.token({ name: 'Ada ', ...claims });
    if (reason === 'signature')
      token = `${token.slice(0, token.lastIndexOf('.') + 1)}invalid-signature`;
    const { context, response } = createContext({
      authorization: `Bearer ${token}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(identityResolver.resolve).not.toHaveBeenCalled();
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

  it('keeps runtime verification causes out of logs and OAuth responses', async () => {
    const identityResolver = {
      resolve: jest.fn().mockRejectedValue(new Error('identity-cause-canary')),
    };
    const guard = createGuard({}, identityResolver);
    jest.spyOn(guard as never, 'verifyToken' as never).mockResolvedValue({
      sub: 'auth0|subject-canary',
      iss: 'https://example.us.auth0.com/',
      scope: 'preferences:read',
    } as never);
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const { context, response } = createContext({
      authorization: 'Bearer token-canary',
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith('MCP token validation failed');
    const diagnostics = JSON.stringify([
      warn.mock.calls,
      response.setHeader.mock.calls,
      response.json.mock.calls,
    ]);
    expect(diagnostics).not.toContain('identity-cause-canary');
    expect(diagnostics).not.toContain('subject-canary');
    expect(diagnostics).not.toContain('token-canary');
    expect(response.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      error_description: 'Invalid token',
    });
  });

  it('resolves a verified human subject through the provider-neutral boundary', async () => {
    const identityResolver = {
      resolve: jest.fn().mockResolvedValue({
        userId: 'principal-1',
        email: 'person@example.test',
      }),
    };
    const authService = { findOrCreateM2MUser: jest.fn() };
    const guard = createGuard(authService, identityResolver);
    jest.spyOn(guard as never, 'verifyToken' as never).mockResolvedValue({
      sub: 'auth0|human',
      iss: 'https://example.us.auth0.com/',
      email: 'person@example.test',
      email_verified: true,
      name: 'Ada',
      azp: 'client-bucket-only',
      scope: 'preferences:read',
    } as never);
    const { context } = createContext({ authorization: 'Bearer token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(identityResolver.resolve).toHaveBeenCalledWith({
      key: {
        provider: 'auth0',
        issuer: 'https://example.us.auth0.com/',
        subject: 'auth0|human',
      },
      profileHints: {
        verifiedEmail: 'person@example.test',
        displayName: 'Ada',
      },
    });
    expect(authService.findOrCreateM2MUser).not.toHaveBeenCalled();
  });

  it('keeps an MCP client subject outside human identity resolution', async () => {
    const identityResolver = { resolve: jest.fn() };
    const authService = {
      findOrCreateM2MUser: jest.fn().mockResolvedValue({
        userId: 'm2m_hash',
        email: 'hash@m2m.invalid',
      }),
    };
    const guard = createGuard(authService, identityResolver);
    jest.spyOn(guard as never, 'verifyToken' as never).mockResolvedValue({
      sub: 'client@clients',
      scope: 'preferences:read',
    } as never);
    const { context } = createContext({ authorization: 'Bearer token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authService.findOrCreateM2MUser).toHaveBeenCalledWith({
      provider: 'auth0',
      issuer: 'https://example.us.auth0.com/',
      subject: 'client@clients',
    });
    expect(identityResolver.resolve).not.toHaveBeenCalled();
  });
});
