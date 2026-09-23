import { registerAs } from '@nestjs/config';

const MAX_CONFIGURATION_BYTES = 2048;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function invalidConfiguration(): never {
  throw new Error('Invalid hosted auth configuration');
}

function parseBoundedValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, 'utf8') > MAX_CONFIGURATION_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidConfiguration();
  }
  return value;
}

function parseCanonicalIssuer(value: unknown): string {
  const issuer = parseBoundedValue(value);
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    return invalidConfiguration();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.pathname !== '/' ||
    parsed.toString() !== issuer
  ) {
    return invalidConfiguration();
  }
  return issuer;
}

export function createAuthConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const issuer = parseCanonicalIssuer(environment.AUTH0_ISSUER);
  const audience = parseBoundedValue(environment.AUTH0_AUDIENCE);

  return {
    auth0: {
      audience,
      issuer,
      jwksUri: new URL('.well-known/jwks.json', issuer).toString(),
    },
  };
}

export function authConfigLoader(environment: NodeJS.ProcessEnv) {
  return registerAs('auth', () => createAuthConfiguration(environment));
}

export default registerAs('auth', () => createAuthConfiguration());
