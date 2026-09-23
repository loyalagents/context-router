import { createAuth0HumanIdentityAssertion } from './auth0-human-identity.assertion';

describe('createAuth0HumanIdentityAssertion', () => {
  const issuer = 'https://tenant.auth0.test/';

  it('maps verified Auth0 claims to the provider-neutral assertion', () => {
    expect(
      createAuth0HumanIdentityAssertion(
        {
          sub: 'auth0|subject',
          iss: issuer,
          email: 'person@example.test',
          email_verified: true,
          name: 'Ada Lovelace',
          given_name: 'Ada',
          family_name: 'Lovelace',
          aud: 'must-not-cross-the-edge',
          scope: 'must-not-cross-the-edge',
        },
        issuer,
      ),
    ).toEqual({
      key: {
        provider: 'auth0',
        issuer,
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

  it.each([false, undefined])(
    'never forwards email without literal verified=true (%p)',
    (emailVerified) => {
      const assertion = createAuth0HumanIdentityAssertion(
        {
          sub: 'auth0|subject',
          iss: issuer,
          email: 'untrusted@example.test',
          email_verified: emailVerified,
        },
        issuer,
      );

      expect(assertion.profileHints).toBeUndefined();
    },
  );

  it.each([undefined, null, ''])('rejects an invalid subject (%p)', (sub) => {
    expect(() =>
      createAuth0HumanIdentityAssertion({ sub, iss: issuer }, issuer),
    ).toThrow('Invalid hosted identity token');
  });

  it.each([undefined, 'https://other.auth0.test/'])(
    'rejects a missing or mismatched verified issuer (%p)',
    (iss) => {
      expect(() =>
        createAuth0HumanIdentityAssertion(
          { sub: 'auth0|subject', iss },
          issuer,
        ),
      ).toThrow('Invalid hosted identity token');
    },
  );

  it.each([
    [{ sub: 'auth0|subject', iss: issuer, email_verified: 'true' }],
    [
      {
        sub: 'auth0|subject',
        iss: issuer,
        email_verified: true,
        email: undefined,
      },
    ],
    [
      {
        sub: 'auth0|subject',
        iss: issuer,
        email_verified: true,
        email: 'not-an-email',
      },
    ],
    [{ sub: 'auth0|subject', iss: issuer, name: { secret: 'no' } }],
    [{ sub: 'auth0|subject', iss: issuer, given_name: 'bad\u0000name' }],
    [{ sub: 'auth0|subject', iss: issuer, family_name: 'x'.repeat(257) }],
    [{ sub: `auth0|${'x'.repeat(1025)}`, iss: issuer }],
  ])('rejects malformed supported claims %#', (payload) => {
    expect(() => createAuth0HumanIdentityAssertion(payload, issuer)).toThrow(
      'Invalid hosted identity token',
    );
  });
});
