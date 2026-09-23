import { createAuthConfiguration } from './auth.config';

describe('hosted auth configuration', () => {
  const environment = {
    AUTH0_ISSUER: 'https://tenant.auth0.com/',
    AUTH0_AUDIENCE: 'https://context-router.test',
  } satisfies NodeJS.ProcessEnv;

  it('builds the hosted verifier snapshot from only issuer and audience', () => {
    expect(createAuthConfiguration(environment)).toEqual({
      auth0: {
        audience: 'https://context-router.test',
        issuer: 'https://tenant.auth0.com/',
        jwksUri: 'https://tenant.auth0.com/.well-known/jwks.json',
      },
    });
  });

  it.each([
    [{ ...environment, AUTH0_ISSUER: undefined }],
    [{ ...environment, AUTH0_ISSUER: 'http://tenant.auth0.com/' }],
    [{ ...environment, AUTH0_ISSUER: 'https://tenant.auth0.com' }],
    [{ ...environment, AUTH0_ISSUER: 'https://tenant.auth0.com/path/' }],
    [{ ...environment, AUTH0_ISSUER: 'https://user@tenant.auth0.com/' }],
    [{ ...environment, AUTH0_AUDIENCE: undefined }],
    [{ ...environment, AUTH0_AUDIENCE: '' }],
  ])(
    'rejects incomplete or non-canonical hosted verifier input %#',
    (input) => {
      expect(() => createAuthConfiguration(input)).toThrow(
        'Invalid hosted auth configuration',
      );
    },
  );

  it('does not retain management, domain, sync, legacy, or link settings', () => {
    const config = createAuthConfiguration({
      ...environment,
      AUTH0_DOMAIN: 'ignored.auth0.com',
      AUTH0_CLIENT_ID: 'ignored-client',
      AUTH0_CLIENT_SECRET: 'ignored-secret',
      AUTH0_MANAGEMENT_API_AUDIENCE: 'https://ignored/api/v2/',
      AUTH0_SYNC_STRATEGY: 'BACKGROUND',
      AUTH0_LEGACY_ISSUER: 'urn:ignored',
      AUTH0_IDENTITY_LINK_CLAIMS: 'ignored',
      JWT_SECRET: 'ignored-jwt-secret',
      JWT_EXPIRES_IN: '99h',
    });

    const serialized = JSON.stringify(config);
    for (const forbidden of [
      'domain',
      'clientId',
      'clientSecret',
      'managementApiAudience',
      'syncStrategy',
      'legacyIssuer',
      'identityLinkClaims',
      'ignored-secret',
      'ignored-jwt-secret',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('uses the provided snapshot instead of ambient process values', () => {
    const originalIssuer = process.env.AUTH0_ISSUER;
    process.env.AUTH0_ISSUER = 'https://ambient.invalid/';
    try {
      expect(createAuthConfiguration(environment).auth0.issuer).toBe(
        'https://tenant.auth0.com/',
      );
    } finally {
      if (originalIssuer === undefined) delete process.env.AUTH0_ISSUER;
      else process.env.AUTH0_ISSUER = originalIssuer;
    }
  });
});
