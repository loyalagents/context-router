import { getFactValue } from '../shared.mjs';
import { evalSlugForFactKey } from '../eval-runner/actions.mjs';

export function seedSlugByFactKey(profile) {
  const byFactKey = new Map();
  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts ?? {}, entry.factKey);
    if (value == null) continue;
    byFactKey.set(entry.factKey, entry.slug);
  }
  return byFactKey;
}

export function storageSpecForFact(factKey, { profile, storageMap }) {
  const seedSlugs = seedSlugByFactKey(profile);
  const mapEntry = storageMap.facts?.[factKey] ?? {};
  const seedSlug = seedSlugs.get(factKey);
  const derivedEvalSlug = evalSlugForFactKey(factKey);
  const canonicalSlugs = unique([
    ...(seedSlug ? [seedSlug] : []),
    ...(mapEntry.canonicalSlugs ?? []),
    ...(!seedSlug && !(mapEntry.canonicalSlugs?.length) ? [derivedEvalSlug] : []),
  ]);
  const acceptedAliasSlugs = unique(mapEntry.acceptedAliasSlugs ?? []);
  return {
    factKey,
    canonicalSlugs,
    acceptedAliasSlugs,
    acceptedSlugs: unique([...canonicalSlugs, ...acceptedAliasSlugs]),
    valueType: mapEntry.valueType ?? 'string',
  };
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

