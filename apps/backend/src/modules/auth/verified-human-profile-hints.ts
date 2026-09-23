import type { VerifiedHumanIdentityProfileHints } from '@/domains/shared/ports/verified-human-identity';

const PROFILE_HINT_KEYS = new Set([
  'verifiedEmail',
  'displayName',
  'givenName',
  'familyName',
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function optionalCanonicalString(
  value: unknown,
  maxBytes: number,
): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, 'utf8') > maxBytes ||
    Buffer.from(value, 'utf8').toString('utf8') !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return undefined;
  }
  return value;
}

/** Discard unusable optional values, but fail closed on adapter contract errors. */
export function normalizeVerifiedHumanProfileHints(
  value: unknown,
): VerifiedHumanIdentityProfileHints | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !PROFILE_HINT_KEYS.has(key))
  ) {
    throw new Error('Invalid verified human identity assertion');
  }

  const hints = value as Record<string, unknown>;
  const result: VerifiedHumanIdentityProfileHints = {};
  const email = optionalCanonicalString(hints.verifiedEmail, 320);
  if (email !== undefined && !/\s/.test(email) && /^[^@]+@[^@]+$/.test(email)) {
    result.verifiedEmail = email;
  }
  for (const key of ['displayName', 'givenName', 'familyName'] as const) {
    const name = optionalCanonicalString(hints[key], 256);
    if (name !== undefined) {
      result[key] = name;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
