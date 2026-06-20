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
  if (Array.isArray(value)) {
    return [
      ...new Set(value.flatMap((entry) => factValueVariants(factKey, entry))),
    ];
  }
  if (value == null || isPlainObject(value)) return [];
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

  if (factKey === 'workAuthorization.i94AdmissionNumber' && digits.length > 0) {
    variants.add(digits);
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

  if (factKey === 'address.current.street') {
    for (const variant of streetSuffixVariants(raw)) {
      variants.add(variant);
    }
  }

  if (factKey === 'address.current.unit') {
    for (const variant of unitVariants(raw)) {
      variants.add(variant);
    }
  }

  if (factKey === 'employment.company') {
    for (const variant of ampersandAndVariants(raw)) {
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
    factKey === 'identity.legalName' ||
    factKey === 'identity.firstName' ||
    factKey === 'identity.lastName' ||
    factKey === 'identity.middleInitial' ||
    factKey === 'identity.otherLastNames' ||
    factKey === 'identity.dateOfBirth' ||
    factKey === 'address.current.street' ||
    factKey === 'address.current.streetLine' ||
    factKey === 'address.current.unit' ||
    factKey === 'address.current.city' ||
    factKey === 'address.current.cityStateZip' ||
    factKey === 'address.current.postalCode' ||
    factKey === 'address.current.state' ||
    factKey === 'banking.accountHolderName' ||
    factKey === 'banking.accountNumber' ||
    factKey === 'banking.accountType' ||
    factKey === 'banking.institutionName' ||
    factKey === 'banking.routingNumber' ||
    factKey === 'employment.company' ||
    factKey === 'employment.title' ||
    factKey === 'employment.startDate' ||
    factKey === 'tax.filingStatus' ||
    factKey === 'workAuthorization.uscisANumber' ||
    factKey === 'workAuthorization.workAuthorizationExpirationDate' ||
    factKey === 'workAuthorization.i94AdmissionNumber' ||
    factKey === 'workAuthorization.foreignPassportNumber' ||
    factKey === 'workAuthorization.citizenshipStatus'
  );
}

export function textContainsDeclaredFactValue(text, factKey, value) {
  if (factKey === 'identity.otherLastNames' && Array.isArray(value)) {
    return value.every((entry) => textContainsFactValue(text, factKey, entry));
  }

  if (factKey === 'employment.startDate') {
    return textContainsEmploymentStartDate(text, value);
  }

  return textContainsFactValue(text, factKey, value);
}

export function textContainsSplitLegalName(text, profileFacts) {
  const leaves = profileFacts?.leaves;
  if (!leaves) return false;

  const firstName = leaves.get('identity.firstName');
  const lastName = leaves.get('identity.lastName');
  const middleName = leaves.get('identity.middleName');
  const middleInitial = leaves.get('identity.middleInitial');
  if (!hasNameValue(firstName) || !hasNameValue(lastName)) return false;

  const fields = extractLabeledNameFields(text);
  if (!fields.first.some((value) => nameValueContains(value, firstName))) return false;
  if (!fields.last.some((value) => nameValueContains(value, lastName))) return false;

  const expectedMiddleInitial = hasNameValue(middleInitial)
    ? String(middleInitial).trim()[0]
    : hasNameValue(middleName)
      ? String(middleName).trim()[0]
      : null;
  const needsMiddleProof = hasNameValue(middleName) || hasNameValue(middleInitial);
  if (!needsMiddleProof) return true;

  const candidateMiddleValues = [...fields.middle, ...fields.first];
  if (
    hasNameValue(middleName) &&
    candidateMiddleValues.some((value) => nameValueContains(value, middleName))
  ) {
    return true;
  }
  return (
    hasNameValue(expectedMiddleInitial) &&
    candidateMiddleValues.some((value) =>
      nameValueContains(value, expectedMiddleInitial),
    )
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

export function shouldDeriveMissingFactAsForbidden(doc) {
  const role = planDocumentEvaluationRole(doc);
  return (
    doc.category !== 'noise' &&
    role.freshness === 'current' &&
    ['extract', 'corroborate'].includes(role.expectedUse)
  );
}

export function effectiveForbiddenFactKeys(corpusPlan, doc) {
  const declaredFacts = new Set(planDocumentFactKeys(doc));
  const effective = [];
  const seen = new Set();

  function add(factKey) {
    if (declaredFacts.has(factKey) || seen.has(factKey)) return;
    seen.add(factKey);
    effective.push(factKey);
  }

  for (const factKey of corpusPlan?.factContractDefaults?.forbid ?? []) add(factKey);
  for (const factKey of doc?.factContract?.forbid ?? []) add(factKey);
  if (shouldDeriveMissingFactAsForbidden(doc)) {
    for (const missing of corpusPlan?.intentionallyMissing ?? []) {
      if (typeof missing.factKey === 'string') add(missing.factKey);
    }
  }

  return effective;
}

export function planDocumentFactKeys(doc) {
  return doc?.factContract?.include ?? [];
}

export function planDocumentForbiddenFactKeys(doc) {
  return doc?.factContract?.forbid ?? [];
}

export function planDocumentEvaluationRole(doc) {
  return doc?.evaluationRole ?? {};
}

export function planDocumentDetailTier(doc) {
  return planDocumentEvaluationRole(doc).detailTier;
}

export function planDocumentAuthority(doc) {
  return planDocumentEvaluationRole(doc).authority;
}

export function planDocumentFreshness(doc) {
  return planDocumentEvaluationRole(doc).freshness;
}

export function planDocumentExpectedUse(doc) {
  return planDocumentEvaluationRole(doc).expectedUse;
}

export function planDocumentChallengeTags(doc) {
  return planDocumentEvaluationRole(doc).challengeTags ?? [];
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
    `${month}-${day}-${year}`,
    `${paddedMonth}-${paddedDay}-${year}`,
    `${monthName} ${day}, ${year}`,
    `${monthName} ${paddedDay}, ${year}`,
  ];
}

function extractLabeledNameFields(text) {
  const fields = {
    first: [],
    middle: [],
    last: [],
  };

  for (const line of String(text).split(/\r?\n/)) {
    const parsed = parseNameFieldLine(line);
    if (!parsed) continue;
    const kind = classifyNameLabel(parsed.label);
    if (!kind) continue;
    fields[kind].push(parsed.value);
  }

  return fields;
}

function parseNameFieldLine(line) {
  const trimmed = String(line).trim().replace(/^[-*]\s+/, '');
  if (!trimmed) return null;

  const acronymMatch = trimmed.match(/^(FN|LN|MN|MI)\b[\s:=.-]+(.+)$/i);
  if (acronymMatch) {
    return {
      label: acronymMatch[1],
      value: cleanNameFieldValue(acronymMatch[2]),
    };
  }

  const labeledMatch = trimmed.match(
    /^["']?([A-Za-z][A-Za-z0-9_./ -]{0,80})["']?\s*[:=]\s*(.+?)\s*$/,
  );
  if (!labeledMatch) return null;
  return {
    label: labeledMatch[1],
    value: cleanNameFieldValue(labeledMatch[2]),
  };
}

function cleanNameFieldValue(value) {
  return String(value)
    .trim()
    .replace(/,$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function classifyNameLabel(label) {
  const normalized = normalizeNameComparisonText(label);
  if (!normalized) return null;
  if (
    /\b(?:approver|reviewer|manager|preparer|translator|emergency|contact)\b/.test(
      normalized,
    )
  ) {
    return null;
  }

  if (normalized === 'fn') return 'first';
  if (normalized === 'ln') return 'last';
  if (normalized === 'mn' || normalized === 'mi') return 'middle';

  const ownerPrefix = '(?:employee|person|applicant|subject|worker|user|identity)';
  const nativeFieldPrefix = '(?:field\\s+[a-z0-9]+|s\\d+|sec\\d+|section\\s+\\d+)';
  if (
    normalized === 'first name' ||
    normalized === 'given name' ||
    new RegExp(`^(?:${ownerPrefix}\\s+)?first\\s+name$`).test(normalized) ||
    new RegExp(`^${nativeFieldPrefix}\\s+first\\s+name$`).test(normalized)
  ) {
    return 'first';
  }
  if (
    normalized === 'last name' ||
    normalized === 'family name' ||
    normalized === 'surname' ||
    new RegExp(`^(?:${ownerPrefix}\\s+)?last\\s+name$`).test(normalized) ||
    new RegExp(`^${nativeFieldPrefix}\\s+last\\s+name$`).test(normalized)
  ) {
    return 'last';
  }
  if (
    normalized === 'middle name' ||
    normalized === 'middle initial' ||
    new RegExp(`^(?:${ownerPrefix}\\s+)?middle\\s+(?:name|initial)$`).test(normalized) ||
    new RegExp(`^${nativeFieldPrefix}\\s+middle\\s+(?:name|initial)$`).test(
      normalized,
    )
  ) {
    return 'middle';
  }

  return null;
}

function nameValueContains(value, expected) {
  const normalizedValue = normalizeNameComparisonText(value);
  const normalizedExpected = normalizeNameComparisonText(expected);
  if (!normalizedValue || !normalizedExpected) return false;
  return new RegExp(`(^| )${escapeRegex(normalizedExpected)}($| )`).test(
    normalizedValue,
  );
}

function hasNameValue(value) {
  return value != null && String(value).trim().length > 0;
}

function normalizeNameComparisonText(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function streetSuffixVariants(raw) {
  const variants = [];
  for (const [full, short] of STREET_SUFFIX_PAIRS) {
    variants.push(replaceStreetSuffix(raw, full, short));
    variants.push(replaceStreetSuffix(raw, short, full));
    variants.push(replaceStreetSuffix(raw, `${short}.`, full));
  }
  return variants.filter(Boolean);
}

function replaceStreetSuffix(raw, from, to) {
  const pattern = new RegExp(`\\b${escapeRegex(from)}\\.?$`, 'i');
  if (!pattern.test(raw)) return null;
  return raw.replace(pattern, to);
}

function unitVariants(raw) {
  const match = raw.match(/^(?:apt\.?|apartment|unit|#)\s*([a-z0-9][a-z0-9-]*)$/i);
  if (!match) return [];
  const unit = match[1].toUpperCase();
  return [`Apt ${unit}`, `Apartment ${unit}`, `Unit ${unit}`, `#${unit}`];
}

function ampersandAndVariants(raw) {
  const variants = [];
  if (/\s&\s/.test(raw)) variants.push(raw.replace(/\s&\s/g, ' and '));
  if (/\sand\s/i.test(raw)) variants.push(raw.replace(/\sand\s/gi, ' & '));
  return variants;
}

function textContainsEmploymentStartDate(text, value) {
  const normalizedText = normalizeSearchText(text);
  for (const variant of factValueVariants('employment.startDate', value)) {
    const normalizedVariant = normalizeSearchText(variant);
    if (!normalizedVariant) continue;

    let index = normalizedText.indexOf(normalizedVariant);
    while (index !== -1) {
      const windowStart = Math.max(0, index - 90);
      const windowEnd = Math.min(
        normalizedText.length,
        index + normalizedVariant.length + 90,
      );
      const window = normalizedText.slice(windowStart, windowEnd);
      if (EMPLOYMENT_START_CUES.some((cue) => window.includes(cue))) return true;
      index = normalizedText.indexOf(normalizedVariant, index + normalizedVariant.length);
    }
  }

  return false;
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
    factKey === 'identity.firstName' ||
    factKey === 'identity.lastName' ||
    factKey === 'identity.middleInitial' ||
    factKey === 'identity.otherLastNames' ||
    factKey === 'address.current.city' ||
    factKey === 'address.current.unit' ||
    factKey === 'employment.title' ||
    factKey === 'workAuthorization.uscisANumber' ||
    factKey === 'workAuthorization.i94AdmissionNumber' ||
    factKey === 'workAuthorization.foreignPassportNumber' ||
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

const STREET_SUFFIX_PAIRS = [
  ['Avenue', 'Ave'],
  ['Street', 'St'],
  ['Road', 'Rd'],
  ['Lane', 'Ln'],
  ['Drive', 'Dr'],
  ['Boulevard', 'Blvd'],
  ['Court', 'Ct'],
  ['Place', 'Pl'],
  ['Terrace', 'Ter'],
];

const EMPLOYMENT_START_CUES = [
  'hire date',
  'start date',
  'startdate',
  'start_date',
  'first day',
  'employment start',
  'employment begins',
  'date of hire',
  'dateofhire',
  'onboarding start',
  'begins work',
  'work begins',
];

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
