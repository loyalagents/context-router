import { createHash } from 'node:crypto';
import type { Preference } from '@/domains/shared/storage/storage-types';

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}
/** Comparison of reviewed persisted state, not a monotonic version or historical ABA detector. */
export function preferenceRevision(row: Preference): string {
  const keys: Array<keyof Preference> = [
    'id',
    'userId',
    'definitionId',
    'locationId',
    'contextKey',
    'status',
    'value',
    'sourceType',
    'confidence',
    'evidence',
    'lastActorType',
    'lastActorClientKey',
    'lastOrigin',
    'createdAt',
    'updatedAt',
  ];
  return createHash('sha256')
    .update(canonical(Object.fromEntries(keys.map((key) => [key, row[key]]))))
    .digest('hex');
}
