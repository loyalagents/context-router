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

  it.each([false, undefined, null, 'true', 1, {}])(
    'never forwards email without literal verified=true (%p)',
    (emailVerified) => {
      const assertion = createAuth0HumanIdentityAssertion(
        {
          sub: 'auth0|subject',
          iss: issuer,
          email: 'not an email',
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

  it.each(['auth0|subject ', 'bad\u0000subject', 'x'.repeat(1025)])(
    'still rejects a malformed authoritative subject %#',
    (sub) => {
      expect(() =>
        createAuth0HumanIdentityAssertion({ sub, iss: issuer }, issuer),
      ).toThrow('Invalid hosted identity token');
    },
  );

  describe.each(['name', 'given_name', 'family_name'])('%s hint', (claim) => {
    it.each([
      null,
      {},
      '',
      ' Ada',
      'Ada ',
      'bad\u0000name',
      'x'.repeat(257),
      'é'.repeat(129),
      '\ud800',
    ])('omits an invalid value without losing verified contact %#', (value) => {
      expect(
        createAuth0HumanIdentityAssertion(
          {
            sub: 'auth0|subject',
            iss: issuer,
            email: 'person@example.test',
            email_verified: true,
            [claim]: value,
          },
          issuer,
        ),
      ).toEqual({
        key: { provider: 'auth0', issuer, subject: 'auth0|subject' },
        profileHints: { verifiedEmail: 'person@example.test' },
      });
    });
  });

  it.each([
    undefined,
    null,
    {},
    '',
    ' person@example.test',
    'not-an-email',
    'a'.repeat(321),
    '\ud800@example.test',
  ])('omits unusable verified email but keeps a valid name %#', (email) => {
    expect(
      createAuth0HumanIdentityAssertion(
        {
          sub: 'auth0|subject',
          iss: issuer,
          email,
          email_verified: true,
          name: 'Ada',
        },
        issuer,
      ),
    ).toEqual({
      key: { provider: 'auth0', issuer, subject: 'auth0|subject' },
      profileHints: { displayName: 'Ada' },
    });
  });

  it('does not even read email when verification is absent', () => {
    expect(
      createAuth0HumanIdentityAssertion(
        {
          sub: 'auth0|subject',
          iss: issuer,
          get email() {
            throw new Error('unverified email must not be read');
          },
        },
        issuer,
      ),
    ).toEqual({ key: { provider: 'auth0', issuer, subject: 'auth0|subject' } });
  });
});
