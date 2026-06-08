import { getFactValue } from '../shared.mjs';
import { valueTypeFor } from '../eval-runner/actions.mjs';
import { storageSpecForFact } from '../scoring/slugs.mjs';

const SENSITIVE_FACT_PATTERNS = [
  /^identity\.ssn$/,
  /^identity\.dateOfBirth$/,
  /^contact\.phone$/,
  /^contact\.email$/,
  /^workAuthorization\.(?:uscisANumber|workAuthorizationExpirationDate|i94AdmissionNumber|foreignPassportNumber)$/,
];

export function collectDefinitionTargets({ manifest, profile, storageMap }) {
  const factKeys = new Set();
  for (const doc of manifest.documents ?? []) {
    for (const factKey of doc.factContract?.include ?? []) {
      factKeys.add(factKey);
    }
  }
  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts ?? {}, entry.factKey);
    if (value != null) factKeys.add(entry.factKey);
  }

  const targets = [];
  for (const factKey of [...factKeys].sort()) {
    const value = getFactValue(profile.facts ?? {}, factKey);
    const storage = storageSpecForFact(factKey, { profile, storageMap });
    const valueType = backendValueType(storage.valueType, value);
    for (const slug of storage.canonicalSlugs) {
      targets.push({
        factKey,
        slug,
        valueType,
        isSensitive: isSensitiveFact(factKey),
      });
    }
  }
  return uniqueBySlug(targets);
}

export function buildDefinitionInput(target) {
  return {
    slug: target.slug,
    displayName: displayNameForSlug(target.slug),
    description: `Known-schema eval definition for ${target.factKey}.`,
    valueType: target.valueType,
    scope: 'GLOBAL',
    isSensitive: target.isSensitive,
    isCore: false,
  };
}

export function summarizeDefinitionTarget(target, extra = {}) {
  return {
    slug: target.slug,
    factKey: target.factKey,
    valueType: target.valueType,
    isSensitive: target.isSensitive,
    ...extra,
  };
}

export function existingSlugSet(definitions) {
  return new Set(
    (definitions ?? [])
      .map((definition) => definition?.slug)
      .filter((slug) => typeof slug === 'string' && slug.length > 0),
  );
}

function backendValueType(storageValueType, value) {
  const fromStorage = String(storageValueType ?? '').toUpperCase();
  if (['ARRAY', 'BOOLEAN', 'ENUM', 'STRING'].includes(fromStorage)) {
    return fromStorage;
  }
  return valueTypeFor(value);
}

function isSensitiveFact(factKey) {
  return SENSITIVE_FACT_PATTERNS.some((pattern) => pattern.test(factKey));
}

function displayNameForSlug(slug) {
  const lastSegment = slug.split('.').at(-1) ?? slug;
  return lastSegment
    .split('_')
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ');
}

function uniqueBySlug(targets) {
  const bySlug = new Map();
  for (const target of targets) {
    if (!bySlug.has(target.slug)) {
      bySlug.set(target.slug, target);
    }
  }
  return [...bySlug.values()].sort((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
}
