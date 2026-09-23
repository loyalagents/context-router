import { createHash } from 'node:crypto';

export function createSyntheticPrincipalEmail(principalId: string): string {
  const digest = createHash('sha256').update(principalId, 'utf8').digest('hex');
  return `${digest}@principal.invalid`;
}

export interface M2MCompatibilityIdentityKey {
  provider: string;
  issuer: string;
  subject: string;
}

function validateM2MKey(
  key: M2MCompatibilityIdentityKey,
): M2MCompatibilityIdentityKey {
  if (
    typeof key !== 'object' ||
    key === null ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(key.provider) ||
    typeof key.issuer !== 'string' ||
    key.issuer.length === 0 ||
    key.issuer !== key.issuer.trim() ||
    Buffer.byteLength(key.issuer, 'utf8') > 2048 ||
    typeof key.subject !== 'string' ||
    !key.subject.endsWith('@clients') ||
    key.subject !== key.subject.trim() ||
    Buffer.byteLength(key.subject, 'utf8') > 1024 ||
    /[\u0000-\u001f\u007f]/.test(`${key.issuer}${key.subject}`)
  ) {
    throw new Error('Invalid hosted M2M identity');
  }
  return key;
}

function createM2MDigest(
  input: M2MCompatibilityIdentityKey,
  encoding: 'hex' | 'base64url',
) {
  const key = validateM2MKey(input);
  const hash = createHash('sha256').update('context-router:m2m:v1', 'utf8');
  for (const value of [key.provider, key.issuer, key.subject]) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length).update(bytes);
  }
  return hash.digest(encoding);
}

export function createM2MCompatibilityPrincipalId(
  key: M2MCompatibilityIdentityKey,
): string {
  return `m2m_${createM2MDigest(key, 'base64url')}`;
}

export function createM2MCompatibilityEmail(
  key: M2MCompatibilityIdentityKey,
): string {
  return `${createM2MDigest(key, 'hex')}@m2m.invalid`;
}
