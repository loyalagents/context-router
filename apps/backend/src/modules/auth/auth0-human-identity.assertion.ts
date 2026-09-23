import type {
  VerifiedHumanIdentityAssertion,
  VerifiedHumanIdentityProfileHints,
} from '@/domains/shared/ports/verified-human-identity';

export interface HostedJwtPayload {
  sub?: unknown;
  iss?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  azp?: unknown;
  scope?: unknown;
  permissions?: unknown;
  [key: string]: unknown;
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function invalidToken(): never {
  throw new Error('Invalid hosted identity token');
}

function canonicalString(
  value: unknown,
  maxBytes: number,
  required: boolean,
): string | undefined {
  if (value === undefined && !required) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, 'utf8') > maxBytes ||
    Buffer.from(value, 'utf8').toString('utf8') !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidToken();
  }
  return value;
}

export function createAuth0HumanIdentityAssertion(
  payload: HostedJwtPayload,
  issuer: string,
): VerifiedHumanIdentityAssertion {
  if (payload.iss !== issuer) {
    return invalidToken();
  }
  const subject = canonicalString(payload.sub, 1024, true);
  if (
    payload.email_verified !== undefined &&
    typeof payload.email_verified !== 'boolean'
  ) {
    return invalidToken();
  }

  const email = canonicalString(payload.email, 320, false);
  if (
    email !== undefined &&
    (/\s/.test(email) || !/^[^@]+@[^@]+$/.test(email))
  ) {
    return invalidToken();
  }
  if (payload.email_verified === true && email === undefined) {
    return invalidToken();
  }

  const displayName = canonicalString(payload.name, 256, false);
  const givenName = canonicalString(payload.given_name, 256, false);
  const familyName = canonicalString(payload.family_name, 256, false);

  const profileHints: VerifiedHumanIdentityProfileHints = {};
  if (payload.email_verified === true) {
    profileHints.verifiedEmail = email;
  }
  profileHints.displayName = displayName;
  profileHints.givenName = givenName;
  profileHints.familyName = familyName;

  for (const key of Object.keys(profileHints) as Array<
    keyof VerifiedHumanIdentityProfileHints
  >) {
    if (profileHints[key] === undefined) {
      delete profileHints[key];
    }
  }

  return {
    key: {
      provider: 'auth0',
      issuer,
      subject,
    },
    ...(Object.keys(profileHints).length > 0 ? { profileHints } : {}),
  };
}
