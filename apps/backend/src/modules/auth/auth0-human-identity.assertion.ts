import type { VerifiedHumanIdentityAssertion } from '@/domains/shared/ports/verified-human-identity';
import { normalizeVerifiedHumanProfileHints } from './verified-human-profile-hints';

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

function canonicalString(value: unknown, maxBytes: number): string {
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
  const subject = canonicalString(payload.sub, 1024);
  const profileHints = normalizeVerifiedHumanProfileHints({
    verifiedEmail: payload.email_verified === true ? payload.email : undefined,
    displayName: payload.name,
    givenName: payload.given_name,
    familyName: payload.family_name,
  });

  return {
    key: {
      provider: 'auth0',
      issuer,
      subject,
    },
    ...(profileHints ? { profileHints } : {}),
  };
}
