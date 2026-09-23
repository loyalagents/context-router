import { generateKeyPairSync, sign } from 'node:crypto';

// Test-only issuer: real RSA signatures, no provider or network dependency.
export function createHumanJwtFixture(issuer: string, audience: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    token(overrides: Record<string, unknown> = {}) {
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const input = `${encode({ alg: 'RS256', kid: 'test-human-key' })}.${encode(
        {
          sub: 'auth0|human',
          iss: issuer,
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 300,
          ...overrides,
        },
      )}`;
      return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
    },
  };
}
