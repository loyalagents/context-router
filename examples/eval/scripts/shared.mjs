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
    variants.add(`${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5)}`);
    variants.add(`${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`);
  }

  if (factKey === 'workAuthorization.uscisANumber' && digits.length > 0) {
    variants.add(digits);
    variants.add(`A${digits}`);
    variants.add(`A-${digits}`);
    variants.add(`A ${digits}`);
  }

  if (DATE_FACT_KEYS.has(factKey)) {
    for (const variant of dateVariants(raw)) {
      variants.add(variant);
    }
  }

  if (factKey === 'address.current.state') {
    const stateVariant = stateNameOrAbbreviation(raw);
    if (stateVariant) variants.add(stateVariant);
  }

  if (factKey === 'workAuthorization.citizenshipStatus') {
    for (const variant of citizenshipStatusVariants(raw)) {
      variants.add(variant);
    }
  }

  return [...variants];
}

export function isHighConfidenceFactKey(factKey) {
  return (
    factKey === 'contact.email' ||
    factKey === 'employment.workEmail' ||
    factKey === 'identity.ssn' ||
    factKey === 'identity.dateOfBirth' ||
    factKey === 'address.current.postalCode' ||
    factKey === 'address.current.state' ||
    factKey === 'workAuthorization.uscisANumber' ||
    factKey === 'workAuthorization.citizenshipStatus'
  );
}

export function textContainsFactValue(text, factKey, value) {
  const normalizedText = normalizeSearchText(text);
  return factValueVariants(factKey, value).some((variant) => {
    const normalizedVariant = normalizeSearchText(variant);
    if (!normalizedVariant) return false;
    if (requiresTokenBoundary(factKey, normalizedVariant)) {
      return new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedVariant)}($|[^a-z0-9])`).test(
        normalizedText,
      );
    }
    return normalizedText.includes(normalizedVariant);
  });
}

function normalizeSearchText(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()
    .toLowerCase();
}

function dateVariants(raw) {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];

  const [, year, paddedMonth, paddedDay] = match;
  const month = Number(paddedMonth);
  const day = Number(paddedDay);
  if (month < 1 || month > 12 || day < 1 || day > 31) return [];

  const monthName = MONTH_NAMES[month - 1];
  return [
    `${month}/${day}/${year}`,
    `${paddedMonth}/${paddedDay}/${year}`,
    `${monthName} ${day}, ${year}`,
    `${monthName} ${paddedDay}, ${year}`,
  ];
}

function citizenshipStatusVariants(raw) {
  const normalized = normalizeSearchText(raw).replace(/\./g, '');
  if (normalized.includes('us citizen') || normalized.includes('united states citizen')) {
    return [
      'U.S. citizen',
      'U. S. citizen',
      'US citizen',
      'U S citizen',
      'United States citizen',
      'citizen of the United States',
    ];
  }

  if (
    normalized.includes('lawful permanent resident') ||
    normalized === 'permanent resident' ||
    normalized === 'lpr'
  ) {
    return [
      'lawful permanent resident',
      'permanent resident',
      'LPR',
      'green card holder',
    ];
  }

  return [];
}

function stateNameOrAbbreviation(raw) {
  const normalized = normalizeSearchText(raw).replace(/\./g, '');
  if (normalized.length === 2) {
    return US_STATE_NAMES_BY_ABBREVIATION.get(normalized.toUpperCase()) ?? null;
  }

  const abbreviation = US_STATE_ABBREVIATIONS_BY_NAME.get(normalized);
  return abbreviation ?? null;
}

function requiresTokenBoundary(factKey, normalizedVariant) {
  return (
    factKey === 'identity.ssn' ||
    factKey === 'workAuthorization.uscisANumber' ||
    (factKey === 'address.current.state' && normalizedVariant.length === 2)
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DATE_FACT_KEYS = new Set([
  'identity.dateOfBirth',
  'employment.startDate',
  'workAuthorization.workAuthorizationExpirationDate',
]);

const US_STATE_PAIRS = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
  ['DC', 'District of Columbia'],
];

const US_STATE_NAMES_BY_ABBREVIATION = new Map(US_STATE_PAIRS);
const US_STATE_ABBREVIATIONS_BY_NAME = new Map(
  US_STATE_PAIRS.map(([abbreviation, name]) => [
    normalizeSearchText(name),
    abbreviation,
  ]),
);
