import { Logger, UnauthorizedException } from '@nestjs/common';
import passport from 'passport';
import { HUMAN_AUTH_STRATEGY } from '../../../domains/shared/ports/human-auth.constants';
import { JwtStrategy } from './jwt.strategy';
import { createHumanJwtFixture } from '../../../../test/fixtures/human-jwt';

describe('JwtStrategy', () => {
  const signed = createHumanJwtFixture(
    'https://tenant.auth0.test/',
    'https://context-router.test',
  );

  function authenticate(strategy: JwtStrategy, token: string) {
    // Replace only key retrieval; Passport still verifies the real JWT.
    Object.assign(strategy, {
      _secretOrKeyProvider: (
        _request: unknown,
        _token: string,
        done: (error: Error | null, key: string) => void,
      ) => done(null, signed.publicKey),
    });
    return new Promise((resolve, reject) => {
      strategy.success = resolve;
      strategy.fail = reject;
      strategy.error = reject;
      strategy.authenticate({
        headers: { authorization: `Bearer ${token}` },
      } as never);
    });
  }
  function createStrategy() {
    const values: Record<string, string> = {
      'auth.auth0.audience': 'https://context-router.test',
      'auth.auth0.issuer': 'https://tenant.auth0.test/',
      'auth.auth0.jwksUri': 'https://tenant.auth0.test/.well-known/jwks.json',
    };
    const authService = { findOrCreateM2MUser: jest.fn() };
    const identityResolver = { resolve: jest.fn() };
    const strategy = new JwtStrategy(
      { get: jest.fn((key: string) => values[key]) } as never,
      authService as never,
      identityResolver as never,
    );
    return { strategy, authService, identityResolver };
  }

  afterEach(() => {
    passport.unuse(HUMAN_AUTH_STRATEGY);
    jest.restoreAllMocks();
  });

  it('authenticates a signed human JWT despite malformed optional profile claims', async () => {
    const { strategy, identityResolver } = createStrategy();
    const existing = { userId: 'principal-existing' };
    identityResolver.resolve.mockResolvedValue(existing);
    await expect(
      authenticate(
        strategy,
        signed.token({
          name: 'Ada ',
          email: 'not an email',
          email_verified: true,
          given_name: 'Ada',
        }),
      ),
    ).resolves.toBe(existing);
    expect(identityResolver.resolve).toHaveBeenCalledWith({
      key: {
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
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
    const { strategy, identityResolver } = createStrategy();
    let token = signed.token({ name: 'Ada ', ...claims });
    if (reason === 'signature')
      token = `${token.slice(0, token.lastIndexOf('.') + 1)}invalid-signature`;
    await expect(authenticate(strategy, token)).rejects.toBeDefined();
    expect(identityResolver.resolve).not.toHaveBeenCalled();
  });

  it('emits a provider-neutral assertion from verified human token claims', async () => {
    const { strategy, identityResolver } = createStrategy();
    const expectedUser = {
      userId: 'principal-1',
      email: 'person@example.test',
    };
    identityResolver.resolve.mockResolvedValue(expectedUser);

    await expect(
      strategy.validate({
        sub: 'auth0|subject',
        iss: 'https://tenant.auth0.test/',
        aud: ['other', 'https://context-router.test'],
        email: 'person@example.test',
        email_verified: true,
        name: 'Ada Lovelace',
        given_name: 'Ada',
        family_name: 'Lovelace',
        azp: 'must-not-become-a-human-key',
        scope: 'preferences:read',
      }),
    ).resolves.toBe(expectedUser);

    expect(identityResolver.resolve).toHaveBeenCalledWith({
      key: {
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'auth0|subject',
      },
      profileHints: {
        verifiedEmail: 'person@example.test',
        displayName: 'Ada Lovelace',
        givenName: 'Ada',
        familyName: 'Lovelace',
      },
    });
  });

  it('does not forward an unverified email', async () => {
    const { strategy, identityResolver } = createStrategy();
    identityResolver.resolve.mockResolvedValue({ userId: 'principal-1' });

    await strategy.validate({
      sub: 'auth0|subject',
      iss: 'https://tenant.auth0.test/',
      aud: 'https://context-router.test',
      email: 'unverified@example.test',
      email_verified: false,
    });

    expect(identityResolver.resolve).toHaveBeenCalledWith({
      key: {
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'auth0|subject',
      },
    });
  });

  it('keeps the M2M compatibility bucket outside human external identity', async () => {
    const { strategy, authService, identityResolver } = createStrategy();
    const expectedUser = { userId: 'm2m_hash', email: 'hash@m2m.invalid' };
    authService.findOrCreateM2MUser.mockResolvedValue(expectedUser);

    await expect(
      strategy.validate({
        sub: 'client-id@clients',
        aud: 'https://context-router.test',
      }),
    ).resolves.toBe(expectedUser);

    expect(authService.findOrCreateM2MUser).toHaveBeenCalledWith({
      provider: 'auth0',
      issuer: 'https://tenant.auth0.test/',
      subject: 'client-id@clients',
    });
    expect(identityResolver.resolve).not.toHaveBeenCalled();
  });

  it('does not log raw audience claims', async () => {
    const error = jest.spyOn(Logger.prototype, 'error');
    const { strategy } = createStrategy();

    await expect(
      strategy.validate({
        sub: 'auth0|subject-canary',
        aud: 'audience-canary',
      }),
    ).rejects.toEqual(new UnauthorizedException('Invalid audience'));

    expect(error).toHaveBeenCalledWith('JWT audience validation failed');
    expect(JSON.stringify(error.mock.calls)).not.toContain('audience-canary');
    expect(JSON.stringify(error.mock.calls)).not.toContain('subject-canary');
  });

  it('does not log resolver causes or token claims', async () => {
    const error = jest.spyOn(Logger.prototype, 'error');
    const { strategy, identityResolver } = createStrategy();
    identityResolver.resolve.mockRejectedValue(
      new Error('resolver-cause-canary'),
    );

    await expect(
      strategy.validate({
        sub: 'auth0|subject-canary',
        iss: 'https://tenant.auth0.test/',
        aud: 'https://context-router.test',
      }),
    ).rejects.toEqual(new UnauthorizedException('Invalid token'));

    expect(error).toHaveBeenCalledWith('JWT human validation failed');
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      'resolver-cause-canary',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('subject-canary');
  });
});
