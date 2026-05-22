import { createHash } from 'node:crypto';

export const FIXTURE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SEED_PATTERN = /^[a-z0-9_-]+$/;

export const CATEGORY_VALUES = [
  'identity',
  'address-contact',
  'hr-onboarding',
  'payroll-tax',
  'work-authorization',
  'employer-context',
  'partial-conflicting',
  'noise',
];

export const OUTPUT_EXTENSION_VALUES = ['md', 'txt', 'json', 'yaml'];
export const DETAIL_TIER_VALUES = ['hero', 'medium', 'brief'];
export const AUTHORITY_VALUES = ['high', 'medium', 'low', 'none'];
export const FRESHNESS_VALUES = ['current', 'stale', 'mixed', 'unknown'];
export const EXPECTED_USE_VALUES = ['extract', 'corroborate', 'guardrail', 'ignore'];

export function deriveSeedPreferences(profile) {
  const rows = [];

  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts, entry.factKey);
    if (value == null) continue;
    rows.push({ slug: entry.slug, value });
  }

  return rows.sort((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
}

export function collectFactKeys(value, prefix = '') {
  const leaves = new Map();
  const areas = new Set();

  function visit(current, currentPath) {
    if (isPlainObject(current)) {
      if (currentPath) areas.add(currentPath);
      for (const [key, child] of Object.entries(current)) {
        visit(child, currentPath ? `${currentPath}.${key}` : key);
      }
      return;
    }
    if (currentPath) leaves.set(currentPath, current);
  }

  visit(value, prefix);
  return { leaves, areas };
}

export function classifyFactKey(profileFacts, factKey) {
  if (profileFacts.leaves.has(factKey)) {
    return { kind: 'leaf', value: profileFacts.leaves.get(factKey) };
  }
  if (profileFacts.areas.has(factKey)) return { kind: 'area' };
  return { kind: 'missing' };
}

export function getFactValue(facts, factKey) {
  return factKey.split('.').reduce((value, segment) => {
    if (!isPlainObject(value)) return undefined;
    return value[segment];
  }, facts);
}

export function setNestedValue(target, factKey, value) {
  const segments = factKey.split('.');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

export function hashHex(...parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function hashInt(...parts) {
  return parseInt(hashHex(...parts).slice(0, 8), 16);
}

export function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function isFixtureId(value) {
  return typeof value === 'string' && FIXTURE_ID_PATTERN.test(value);
}

export function toPosixPath(value) {
  return value.split(/[\\/]+/).join('/');
}

export function factValueVariants(factKey, value) {
  if (value == null || isPlainObject(value) || Array.isArray(value)) return [];
  const raw = String(value).trim();
  if (!raw) return [];

  const variants = new Set([raw]);
  const digits = raw.replace(/\D/g, '');

  if (factKey === 'identity.ssn' && digits.length === 9) {
    variants.add(digits);
    variants.add(`${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`);
  }

  if (factKey === 'workAuthorization.uscisANumber' && digits.length > 0) {
    variants.add(digits);
    variants.add(`A${digits}`);
    variants.add(`A-${digits}`);
  }

  return [...variants];
}

export function isHighConfidenceFactKey(factKey) {
  return (
    factKey === 'contact.email' ||
    factKey === 'identity.ssn' ||
    factKey === 'workAuthorization.uscisANumber' ||
    factKey === 'employment.workEmail'
  );
}

export function textContainsFactValue(text, factKey, value) {
  const normalizedText = normalizeSearchText(text);
  return factValueVariants(factKey, value).some((variant) =>
    normalizedText.includes(normalizeSearchText(variant)),
  );
}

function normalizeSearchText(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()
    .toLowerCase();
}
