import path from 'node:path';
import { collectFactKeys, getFactValue } from '../shared.mjs';
import { readJson, readYaml, validateWithSchema, writeJson } from './io.mjs';
import { isAbsentValue, rate, valueMatchesFact } from './normalize.mjs';
import { storageSpecForFact, unique } from './slugs.mjs';
import {
  buildFixtureReadiness,
  collectKnownPresentFactKeys,
  collectMissingFactEntries,
} from './database.mjs';

const ACTIVE_STATUS = 'ACTIVE';
const OWNERSHIP_CLEAN = 'clean';
const OWNERSHIP_ALLOWED_SCOPED = 'allowed_scoped';
const OWNERSHIP_FORBIDDEN_ACTIVE_LEAK = 'forbidden_active_leak';
const OWNERSHIP_FORBIDDEN_SUGGESTION_LEAK = 'forbidden_suggestion_leak';

const EMERGENCY_CONTACT_ALLOWED_PREFIXES = [
  'identity.emergency_contact.',
  'identity.emergencyContact.',
  'emergency_contact.',
  'emergencyContact.',
];
const MANAGER_ALLOWED_PREFIXES = [
  'manager.',
  'employment.manager.',
  'team.manager.',
];

export async function scoreOpenSchemaDatabaseToFile({
  repoRoot,
  userId,
  corpusId,
  memorySnapshotPath,
  validationReportPath,
  outPath,
}) {
  const report = await scoreOpenSchemaDatabase({
    repoRoot,
    userId,
    corpusId,
    memorySnapshotPath,
    validationReportPath,
  });
  await validateWithSchema(
    repoRoot,
    'open-schema-database-score-report.schema.json',
    report,
    'open-schema database score report',
  );
  await writeJson(outPath, report);
  return report;
}

export async function scoreOpenSchemaDatabase({
  repoRoot,
  userId,
  corpusId,
  memorySnapshotPath,
  validationReportPath,
}) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', userId);
  const corpusRoot = path.join(userRoot, 'corpora', corpusId);
  const [profile, manifest, validationReport, storageMap, memorySnapshot] =
    await Promise.all([
      readYaml(path.join(userRoot, 'profile.yaml')),
      readJson(path.join(corpusRoot, 'manifest.json')),
      readJson(validationReportPath ?? path.join(corpusRoot, 'validation-report.json')),
      readJson(path.join(evalRoot, 'scoring/fact-storage-map.v1.json')),
      readJson(memorySnapshotPath),
    ]);

  await validateWithSchema(
    repoRoot,
    'memory-snapshot.schema.json',
    memorySnapshot,
    'memory snapshot',
  );

  if (memorySnapshot.userId !== userId) {
    throw new Error(`memory-snapshot userId ${memorySnapshot.userId} does not match ${userId}`);
  }
  if (memorySnapshot.corpusId !== corpusId) {
    throw new Error(
      `memory-snapshot corpusId ${memorySnapshot.corpusId} does not match ${corpusId}`,
    );
  }

  const profileFacts = collectFactKeys(profile.facts ?? {});
  const fixtureReadiness = buildFixtureReadiness(validationReport);
  const activePreferences = (memorySnapshot.preferences ?? []).filter(
    (preference) => preference.status === ACTIVE_STATUS,
  );
  const ignoredMemoryPreferences = (memorySnapshot.preferences ?? [])
    .filter((preference) => preference.status !== ACTIVE_STATUS)
    .map(preferenceSummary)
    .sort(comparePreferenceSummaries);
  const suggestions = memorySnapshot.suggestions ?? [];
  const schemaDiagnostics = buildSchemaDiagnostics({ memorySnapshot });

  const knownFactKeys = fixtureReadiness.scorable
    ? collectKnownPresentFactKeys(validationReport, profileFacts)
    : [];
  const missingFactEntries = fixtureReadiness.scorable
    ? await collectMissingFactEntries({
        repoRoot,
        manifest,
        profileFacts,
        profile,
      })
    : [];

  const usedPreferenceIndexes = new Set();
  const usedSuggestionIndexes = new Set();
  const knownPresent = knownFactKeys.map((factKey) =>
    scoreOpenKnownFact({
      factKey,
      profile,
      storageMap,
      activePreferences,
      suggestions,
      usedPreferenceIndexes,
      usedSuggestionIndexes,
    }),
  );
  const intentionallyMissing = missingFactEntries.map((entry) =>
    scoreOpenMissingFact({
      entry,
      profile,
      storageMap,
      activePreferences,
      suggestions,
      usedPreferenceIndexes,
      usedSuggestionIndexes,
    }),
  );
  const ownershipDecoyAudit = scoreOwnershipDecoyAudit({
    manifest,
    profile,
    storageMap,
    activePreferences,
    suggestions,
  });

  const unscoredActivePreferences = activePreferences
    .filter((_preference, index) => !usedPreferenceIndexes.has(index))
    .map(preferenceSummary)
    .sort(comparePreferenceSummaries);
  const unscoredSuggestions = suggestions
    .filter((_preference, index) => !usedSuggestionIndexes.has(index))
    .map(preferenceSummary)
    .sort(comparePreferenceSummaries);

  return {
    schemaVersion: 1,
    scoreType: 'open-schema-database-storage',
    userId,
    corpusId,
    storageInput: memorySnapshot.storageInput,
    memorySnapshot: {
      runId: memorySnapshot.runId,
      evaluationMode: memorySnapshot.evaluationMode,
      diagnostics: memorySnapshot.diagnostics,
    },
    fixtureReadiness,
    summary: buildOpenDatabaseSummary({
      knownPresent,
      intentionallyMissing,
      ignoredMemoryPreferences,
      unscoredActivePreferences,
      unscoredSuggestions,
      schemaDiagnostics,
      ownershipDecoyAudit,
    }),
    knownPresent,
    intentionallyMissing,
    ownershipDecoyAudit,
    schemaDiagnostics,
    ignoredMemoryPreferences,
    unscoredActivePreferences,
    unscoredSuggestions,
  };
}

export function scoreOwnershipDecoyAudit({
  manifest,
  profile,
  storageMap,
  activePreferences,
  suggestions,
}) {
  return buildOwnershipDecoyCases({ manifest, profile, storageMap })
    .map((auditCase) =>
      scoreOwnershipDecoyCase({ auditCase, activePreferences, suggestions }),
    )
    .sort(compareOwnershipDecoyRows);
}

function buildOwnershipDecoyCases({ manifest, profile, storageMap }) {
  const decoys = manifest.artifactWorld?.ownershipDecoys;
  if (!isRecord(decoys)) return [];
  const cases = [];
  const addCase = ({
    ownerKey,
    ownerName,
    valueLabel,
    value,
    forbiddenFactKeys,
    allowedSlugPrefixes = [],
  }) => {
    if (isAbsentValue(value)) return;
    const normalizedForbiddenFactKeys = unique(forbiddenFactKeys);
    cases.push({
      ownerKey,
      ownerName,
      valueLabel,
      value,
      allowedSlugPrefixes: unique(allowedSlugPrefixes).sort(),
      forbiddenFactKeys: normalizedForbiddenFactKeys.sort(),
      forbiddenSlugs: slugsForForbiddenFactKeys({
        factKeys: normalizedForbiddenFactKeys,
        profile,
        storageMap,
      }),
    });
  };

  const noah = decoys.noahKim;
  if (isRecord(noah)) {
    addBankingDecoyCases({ addCase, ownerKey: 'noahKim', owner: noah });
    addCase({
      ownerKey: 'noahKim',
      ownerName: noah.name,
      valueLabel: 'workerId',
      value: noah.workerId,
      forbiddenFactKeys: ['employment.workerId'],
    });
  }

  const elena = decoys.elenaChen;
  if (isRecord(elena)) {
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'name',
      value: elena.name,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['identity.legalName'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'phone',
      value: elena.phone,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['contact.phone'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'email',
      value: elena.email,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['contact.email'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'street',
      value: elena.street,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['address.current.street', 'address.current.streetLine'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'unit',
      value: elena.unit,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['address.current.unit', 'address.current.streetLine'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'streetLine',
      value: joinParts([elena.street, elena.unit], ' '),
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['address.current.streetLine'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'city',
      value: elena.city,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['address.current.city', 'address.current.cityStateZip'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'state',
      value: elena.state,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['address.current.state', 'address.current.cityStateZip'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'postalCode',
      value: elena.postalCode,
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['address.current.postalCode', 'address.current.cityStateZip'],
    });
    addCase({
      ownerKey: 'elenaChen',
      ownerName: elena.name,
      valueLabel: 'cityStateZip',
      value: cityStateZip(elena),
      allowedSlugPrefixes: EMERGENCY_CONTACT_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['address.current.cityStateZip'],
    });
  }

  const victor = decoys.victorAlvarez;
  if (isRecord(victor)) {
    addCase({
      ownerKey: 'victorAlvarez',
      ownerName: victor.name,
      valueLabel: 'name',
      value: victor.name,
      allowedSlugPrefixes: MANAGER_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['identity.legalName'],
    });
    addCase({
      ownerKey: 'victorAlvarez',
      ownerName: victor.name,
      valueLabel: 'email',
      value: victor.email,
      allowedSlugPrefixes: MANAGER_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['contact.email', 'employment.workEmail'],
    });
    addCase({
      ownerKey: 'victorAlvarez',
      ownerName: victor.name,
      valueLabel: 'phone',
      value: victor.phone,
      allowedSlugPrefixes: MANAGER_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['contact.phone'],
    });
    addCase({
      ownerKey: 'victorAlvarez',
      ownerName: victor.name,
      valueLabel: 'role',
      value: victor.role,
      allowedSlugPrefixes: MANAGER_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['employment.title'],
    });
    addCase({
      ownerKey: 'victorAlvarez',
      ownerName: victor.name,
      valueLabel: 'workerId',
      value: victor.workerId,
      allowedSlugPrefixes: MANAGER_ALLOWED_PREFIXES,
      forbiddenFactKeys: ['employment.workerId'],
    });
  }

  const ari = decoys.ariPatel;
  if (isRecord(ari)) {
    addBankingDecoyCases({ addCase, ownerKey: 'ariPatel', owner: ari });
    addCase({
      ownerKey: 'ariPatel',
      ownerName: ari.name,
      valueLabel: 'workerId',
      value: ari.workerId,
      forbiddenFactKeys: ['employment.workerId'],
    });
    addCase({
      ownerKey: 'ariPatel',
      ownerName: ari.name,
      valueLabel: 'filingStatus',
      value: ari.filingStatus,
      forbiddenFactKeys: ['tax.filingStatus'],
    });
  }

  const taylor = decoys.taylorBrooks;
  if (isRecord(taylor)) {
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'name',
      value: taylor.name,
      forbiddenFactKeys: ['identity.legalName'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'ssn',
      value: taylor.ssn,
      forbiddenFactKeys: ['identity.ssn'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'streetLine',
      value: taylor.street,
      forbiddenFactKeys: ['address.current.street', 'address.current.streetLine'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'cityStateZip',
      value: taylor.cityStateZip,
      forbiddenFactKeys: ['address.current.cityStateZip'],
    });
    const cityState = parseCityStateZip(taylor.cityStateZip);
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'city',
      value: cityState.city,
      forbiddenFactKeys: ['address.current.city', 'address.current.cityStateZip'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'state',
      value: cityState.state,
      forbiddenFactKeys: ['address.current.state', 'address.current.cityStateZip'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'postalCode',
      value: cityState.postalCode,
      forbiddenFactKeys: ['address.current.postalCode', 'address.current.cityStateZip'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'filingStatus',
      value: taylor.filingStatus,
      forbiddenFactKeys: ['tax.filingStatus'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'multipleJobs',
      value: taylor.multipleJobs,
      forbiddenFactKeys: ['tax.multipleJobs'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'qualifyingChildrenAmount',
      value: taylor.qualifyingChildrenAmount,
      forbiddenFactKeys: ['tax.dependentsUnder17', 'tax.qualifyingChildrenAmount'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'otherDependentsAmount',
      value: taylor.otherDependentsAmount,
      forbiddenFactKeys: ['tax.otherDependents', 'tax.otherDependentsAmount'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'otherIncome',
      value: taylor.otherIncome,
      forbiddenFactKeys: ['tax.otherIncome'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'deductions',
      value: taylor.deductions,
      forbiddenFactKeys: ['tax.deductions'],
    });
    addCase({
      ownerKey: 'taylorBrooks',
      ownerName: taylor.name,
      valueLabel: 'extraWithholding',
      value: taylor.extraWithholding,
      forbiddenFactKeys: ['tax.extraWithholding'],
    });
  }

  return cases;
}

function addBankingDecoyCases({ addCase, ownerKey, owner }) {
  const ownerName = owner.name;
  addCase({
    ownerKey,
    ownerName,
    valueLabel: 'name',
    value: owner.name,
    forbiddenFactKeys: ['banking.accountHolderName', 'identity.legalName'],
  });
  addCase({
    ownerKey,
    ownerName,
    valueLabel: 'institutionName',
    value: owner.institutionName,
    forbiddenFactKeys: ['banking.institutionName'],
  });
  addCase({
    ownerKey,
    ownerName,
    valueLabel: 'routingNumber',
    value: owner.routingNumber,
    forbiddenFactKeys: ['banking.routingNumber'],
  });
  addCase({
    ownerKey,
    ownerName,
    valueLabel: 'accountNumber',
    value: owner.accountNumber,
    forbiddenFactKeys: ['banking.accountNumber'],
  });
  addCase({
    ownerKey,
    ownerName,
    valueLabel: 'accountType',
    value: owner.accountType,
    forbiddenFactKeys: ['banking.accountType'],
  });
}

function scoreOwnershipDecoyCase({ auditCase, activePreferences, suggestions }) {
  const matchingActiveRows = sortPreferenceSummaries(
    activePreferences
      .filter((preference) => valueContainsOwnershipValue(auditCase.value, preference.value))
      .map(preferenceSummary),
  );
  const matchingSuggestionRows = sortPreferenceSummaries(
    suggestions
      .filter((preference) => valueContainsOwnershipValue(auditCase.value, preference.value))
      .map(preferenceSummary),
  );
  const allowedActiveRows = matchingActiveRows.filter((row) =>
    slugIsAllowed(row.slug, auditCase.allowedSlugPrefixes),
  );
  const allowedSuggestionRows = matchingSuggestionRows.filter((row) =>
    slugIsAllowed(row.slug, auditCase.allowedSlugPrefixes),
  );
  const forbiddenActiveRows = matchingActiveRows.filter(
    (row) => !slugIsAllowed(row.slug, auditCase.allowedSlugPrefixes),
  );
  const forbiddenSuggestionRows = matchingSuggestionRows.filter(
    (row) => !slugIsAllowed(row.slug, auditCase.allowedSlugPrefixes),
  );

  return {
    ...auditCase,
    matchingActiveRows,
    matchingSuggestionRows,
    allowedActiveRows,
    forbiddenActiveRows,
    allowedSuggestionRows,
    forbiddenSuggestionRows,
    classification: classifyOwnershipDecoy({
      matchingActiveRows,
      matchingSuggestionRows,
      forbiddenActiveRows,
      forbiddenSuggestionRows,
    }),
  };
}

function classifyOwnershipDecoy({
  matchingActiveRows,
  matchingSuggestionRows,
  forbiddenActiveRows,
  forbiddenSuggestionRows,
}) {
  if (forbiddenActiveRows.length > 0) return OWNERSHIP_FORBIDDEN_ACTIVE_LEAK;
  if (forbiddenSuggestionRows.length > 0) return OWNERSHIP_FORBIDDEN_SUGGESTION_LEAK;
  if (matchingActiveRows.length > 0 || matchingSuggestionRows.length > 0) {
    return OWNERSHIP_ALLOWED_SCOPED;
  }
  return OWNERSHIP_CLEAN;
}

function slugsForForbiddenFactKeys({ factKeys, profile, storageMap }) {
  return unique(
    factKeys.flatMap((factKey) => {
      const storage = storageSpecForFact(factKey, { profile, storageMap });
      return [
        ...storage.acceptedSlugs,
        factKey,
        snakeFactKey(factKey),
        `profile.${snakeFactKey(factKey)}`,
      ];
    }),
  ).sort();
}

function valueContainsOwnershipValue(expected, actual) {
  const expectedVariants = ownershipScalarVariants(expected);
  return flattenScalarValues(actual).some((value) => {
    for (const variant of ownershipScalarVariants(value)) {
      if (expectedVariants.has(variant)) return true;
    }
    return false;
  });
}

function flattenScalarValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenScalarValues);
  if (isRecord(value)) return Object.values(value).flatMap(flattenScalarValues);
  return [value];
}

function ownershipScalarVariants(value) {
  const normalized = normalizeOwnershipScalar(value);
  if (!normalized) return new Set();
  const variants = new Set([normalized]);
  const raw = String(value);
  const digits = raw.replace(/\D/g, '');
  if (digits && digits !== raw) variants.add(digits);
  return variants;
}

function normalizeOwnershipScalar(value) {
  if (value == null) return '';
  return String(value).trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function slugIsAllowed(slug, allowedSlugPrefixes) {
  return allowedSlugPrefixes.some((prefix) => {
    if (prefix.endsWith('.')) {
      return slug === prefix.slice(0, -1) || slug.startsWith(prefix);
    }
    return slug === prefix || slug.startsWith(`${prefix}.`);
  });
}

function joinParts(parts, separator) {
  const filtered = parts.filter((part) => !isAbsentValue(part));
  return filtered.length ? filtered.join(separator) : null;
}

function cityStateZip(value) {
  return joinParts([value.city, joinParts([value.state, value.postalCode], ' ')], ', ');
}

function parseCityStateZip(value) {
  const match = String(value ?? '').match(/^(.*),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!match) return { city: null, state: null, postalCode: null };
  return { city: match[1], state: match[2], postalCode: match[3] };
}

function snakeFactKey(factKey) {
  return factKey
    .split('.')
    .map((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase(),
    )
    .join('.');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function scoreOpenKnownFact({
  factKey,
  profile,
  storageMap,
  activePreferences,
  suggestions,
  usedPreferenceIndexes,
  usedSuggestionIndexes,
}) {
  const expectedValue = getFactValue(profile.facts ?? {}, factKey);
  const storage = storageSpecForFact(factKey, { profile, storageMap });
  const accepted = new Set(storage.acceptedSlugs);
  const matchingActiveRows = [];
  const matchingAcceptedRows = [];
  const matchingNovelRows = [];
  const acceptedSlugRows = [];
  const acceptedWrongRows = [];
  const matchingSuggestionRows = [];

  activePreferences.forEach((preference, index) => {
    const matches = valueMatchesFact(factKey, expectedValue, preference.value);
    const acceptedSlug = accepted.has(preference.slug);
    if (matches) {
      matchingActiveRows.push(preferenceSummary(preference));
      usedPreferenceIndexes.add(index);
      if (acceptedSlug) {
        matchingAcceptedRows.push(preferenceSummary(preference));
      } else {
        matchingNovelRows.push(preferenceSummary(preference));
      }
    }
    if (acceptedSlug) {
      acceptedSlugRows.push(preferenceSummary(preference));
      usedPreferenceIndexes.add(index);
      if (!matches && !isAbsentValue(preference.value)) {
        acceptedWrongRows.push(preferenceSummary(preference));
      }
    }
  });

  suggestions.forEach((preference, index) => {
    if (valueMatchesFact(factKey, expectedValue, preference.value)) {
      matchingSuggestionRows.push(preferenceSummary(preference));
      usedSuggestionIndexes.add(index);
    }
  });

  const derivedActiveMatch = derivedCompositeActiveMatch({
    factKey,
    profile,
    expectedValue,
    activePreferences,
  });
  if (matchingActiveRows.length === 0 && derivedActiveMatch) {
    const derivedRow = derivedPreferenceSummary({
      factKey,
      value: expectedValue,
      sourceRows: derivedActiveMatch.rows.map(({ preference }) =>
        preferenceSummary(preference),
      ),
    });
    matchingActiveRows.push(derivedRow);
    matchingNovelRows.push(derivedRow);
    for (const { index } of derivedActiveMatch.rows) {
      usedPreferenceIndexes.add(index);
    }
  }

  const recoveredUnderAcceptedSlug = matchingAcceptedRows.length > 0;
  const recoveredUnderNovelSlug =
    !recoveredUnderAcceptedSlug && matchingNovelRows.length > 0;
  const valueRecoveredInActiveMemory = matchingActiveRows.length > 0;
  const suggestionOnly = !valueRecoveredInActiveMemory && matchingSuggestionRows.length > 0;
  const acceptedSlugHasWrongValue = acceptedWrongRows.length > 0;
  const conflict = valueRecoveredInActiveMemory && acceptedSlugHasWrongValue;

  return {
    factKey,
    expectedValue,
    canonicalSlugs: storage.canonicalSlugs,
    acceptedAliasSlugs: storage.acceptedAliasSlugs,
    valueRecoveredInActiveMemory,
    recoveredUnderAcceptedSlug,
    recoveredUnderNovelSlug,
    suggestionOnly,
    acceptedSlugPopulated: acceptedSlugRows.some((row) => !isAbsentValue(row.value)),
    acceptedSlugHasWrongValue,
    conflict,
    matchingActiveRows: sortPreferenceSummaries(matchingActiveRows),
    matchingAcceptedRows: sortPreferenceSummaries(matchingAcceptedRows),
    matchingNovelRows: sortPreferenceSummaries(matchingNovelRows),
    acceptedSlugRows: sortPreferenceSummaries(acceptedSlugRows),
    acceptedWrongRows: sortPreferenceSummaries(acceptedWrongRows),
    matchingSuggestionRows: sortPreferenceSummaries(matchingSuggestionRows),
    classification: classifyOpenKnown({
      recoveredUnderAcceptedSlug,
      recoveredUnderNovelSlug,
      suggestionOnly,
      acceptedSlugHasWrongValue,
    }),
  };
}

function derivedCompositeActiveMatch({
  factKey,
  profile,
  expectedValue,
  activePreferences,
}) {
  if (factKey === 'address.current.streetLine') {
    const street = getComponentMatch({
      factKey: 'address.current.street',
      profile,
      activePreferences,
      required: true,
    });
    const unitExpected = getFactValue(profile.facts ?? {}, 'address.current.unit');
    const unit = getComponentMatch({
      factKey: 'address.current.unit',
      profile,
      activePreferences,
      required: !isAbsentValue(unitExpected),
    });
    if (!street || unit === null) return null;
    const rows = unit ? [street, unit] : [street];
    return derivedValueMatchesExpected({ factKey, expectedValue, rows })
      ? { rows }
      : null;
  }

  if (factKey === 'address.current.cityStateZip') {
    const city = getComponentMatch({
      factKey: 'address.current.city',
      profile,
      activePreferences,
      required: true,
    });
    const state = getComponentMatch({
      factKey: 'address.current.state',
      profile,
      activePreferences,
      required: true,
    });
    const postalCode = getComponentMatch({
      factKey: 'address.current.postalCode',
      profile,
      activePreferences,
      required: true,
    });
    if (!city || !state || !postalCode) return null;
    const rows = [city, state, postalCode];
    return derivedValueMatchesExpected({ factKey, expectedValue, rows })
      ? { rows }
      : null;
  }

  if (factKey === 'identity.legalName') {
    const firstName = getComponentMatch({
      factKey: 'identity.firstName',
      profile,
      activePreferences,
      required: true,
    });
    const middleNameExpected = getFactValue(profile.facts ?? {}, 'identity.middleName');
    const middleName = getComponentMatch({
      factKey: 'identity.middleName',
      profile,
      activePreferences,
      required: !isAbsentValue(middleNameExpected),
    });
    const lastName = getComponentMatch({
      factKey: 'identity.lastName',
      profile,
      activePreferences,
      required: true,
    });
    if (!firstName || middleName === null || !lastName) return null;
    const rows = middleName ? [firstName, middleName, lastName] : [firstName, lastName];
    const value = rows.map(({ preference }) => preference.value).join(' ');
    return valueMatchesFact(factKey, expectedValue, value)
      ? { rows, value }
      : null;
  }

  if (factKey === 'identity.middleInitial') {
    const middleName = getComponentMatch({
      factKey: 'identity.middleName',
      profile,
      activePreferences,
      required: true,
    });
    if (!middleName) return null;
    const value = String(middleName.preference.value ?? '').trim().slice(0, 1);
    return valueMatchesFact(factKey, expectedValue, value)
      ? { rows: [middleName], value }
      : null;
  }

  return null;
}

function getComponentMatch({ factKey, profile, activePreferences, required }) {
  const expected = getFactValue(profile.facts ?? {}, factKey);
  if (isAbsentValue(expected)) return required ? null : undefined;
  for (let index = 0; index < activePreferences.length; index += 1) {
    const preference = activePreferences[index];
    if (valueMatchesFact(factKey, expected, preference.value)) {
      return { index, preference };
    }
  }
  return null;
}

function derivedValueMatchesExpected({ factKey, expectedValue, rows }) {
  if (factKey === 'address.current.streetLine') {
    const value = rows.map(({ preference }) => preference.value).join(' ');
    return valueMatchesFact(factKey, expectedValue, value);
  }
  if (factKey === 'address.current.cityStateZip') {
    const [city, state, postalCode] = rows.map(({ preference }) => preference.value);
    return valueMatchesFact(
      factKey,
      expectedValue,
      `${city}, ${state} ${postalCode}`,
    );
  }
  return false;
}

export function scoreOpenMissingFact({
  entry,
  profile,
  storageMap,
  activePreferences,
  suggestions,
  usedPreferenceIndexes,
  usedSuggestionIndexes,
}) {
  const storage = storageSpecForFact(entry.factKey, { profile, storageMap });
  const accepted = new Set(storage.acceptedSlugs);
  const activeValueRows = [];
  const activeAcceptedSlugRows = [];
  const suggestionValueRows = [];
  const suggestionAcceptedSlugRows = [];

  activePreferences.forEach((preference, index) => {
    const acceptedSlug = accepted.has(preference.slug);
    const valueMatches =
      entry.withheldValue != null &&
      valueMatchesFact(entry.factKey, entry.withheldValue, preference.value);
    if (valueMatches) {
      activeValueRows.push(preferenceSummary(preference));
      usedPreferenceIndexes.add(index);
    }
    if (acceptedSlug) {
      usedPreferenceIndexes.add(index);
      if (!isAbsentValue(preference.value)) {
        activeAcceptedSlugRows.push(preferenceSummary(preference));
      }
    }
  });

  suggestions.forEach((preference, index) => {
    const acceptedSlug = accepted.has(preference.slug);
    const valueMatches =
      entry.withheldValue != null &&
      valueMatchesFact(entry.factKey, entry.withheldValue, preference.value);
    if (valueMatches) {
      suggestionValueRows.push(preferenceSummary(preference));
      usedSuggestionIndexes.add(index);
    }
    if (acceptedSlug) {
      usedSuggestionIndexes.add(index);
      if (!isAbsentValue(preference.value)) {
        suggestionAcceptedSlugRows.push(preferenceSummary(preference));
      }
    }
  });

  const activeValueFoundAnywhere = activeValueRows.length > 0;
  const activeAcceptedSlugHasValue = activeAcceptedSlugRows.length > 0;

  return {
    factKey: entry.factKey,
    missingKind: entry.missingKind,
    withheldValue: entry.withheldValue,
    source: entry.source,
    canonicalSlugs: storage.canonicalSlugs,
    acceptedAliasSlugs: storage.acceptedAliasSlugs,
    activeValueFoundAnywhere,
    activeAcceptedSlugHasValue,
    suggestionValueFoundAnywhere: suggestionValueRows.length > 0,
    suggestionAcceptedSlugHasValue: suggestionAcceptedSlugRows.length > 0,
    activeValueRows: sortPreferenceSummaries(activeValueRows),
    activeAcceptedSlugRows: sortPreferenceSummaries(activeAcceptedSlugRows),
    suggestionValueRows: sortPreferenceSummaries(suggestionValueRows),
    suggestionAcceptedSlugRows: sortPreferenceSummaries(suggestionAcceptedSlugRows),
    classification: classifyOpenMissing({
      activeValueFoundAnywhere,
      activeAcceptedSlugHasValue,
    }),
  };
}

function classifyOpenKnown({
  recoveredUnderAcceptedSlug,
  recoveredUnderNovelSlug,
  suggestionOnly,
  acceptedSlugHasWrongValue,
}) {
  if (recoveredUnderAcceptedSlug) return 'open_known_present_recovered_accepted_slug';
  if (recoveredUnderNovelSlug) return 'open_known_present_recovered_novel_slug';
  if (suggestionOnly) return 'open_known_present_suggestion_only';
  if (acceptedSlugHasWrongValue) return 'open_known_present_wrong_value';
  return 'open_known_present_missing';
}

function classifyOpenMissing({
  activeValueFoundAnywhere,
  activeAcceptedSlugHasValue,
}) {
  if (activeValueFoundAnywhere && activeAcceptedSlugHasValue) {
    return 'open_missing_active_hallucinated';
  }
  if (activeValueFoundAnywhere) return 'open_missing_active_value_hallucinated';
  if (activeAcceptedSlugHasValue) return 'open_missing_active_key_hallucinated';
  return 'open_missing_absent_correct';
}

function buildOpenDatabaseSummary({
  knownPresent,
  intentionallyMissing,
  ignoredMemoryPreferences,
  unscoredActivePreferences,
  unscoredSuggestions,
  schemaDiagnostics,
  ownershipDecoyAudit,
}) {
  const knownCounts = countByClassification(knownPresent);
  const missingCounts = countByClassification(intentionallyMissing);
  const ownershipCounts = countByClassification(ownershipDecoyAudit);
  const activeRecovered = knownPresent.filter(
    (row) => row.valueRecoveredInActiveMemory,
  ).length;
  const recoveredOrSuggested = knownPresent.filter(
    (row) => row.valueRecoveredInActiveMemory || row.suggestionOnly,
  ).length;
  const missingActiveHallucinatedTotal =
    (missingCounts.open_missing_active_value_hallucinated ?? 0) +
    (missingCounts.open_missing_active_key_hallucinated ?? 0) +
    (missingCounts.open_missing_active_hallucinated ?? 0);

  return {
    knownPresentTotal: knownPresent.length,
    knownPresentRecoveredActive: activeRecovered,
    knownPresentRecoveredAcceptedSlug:
      knownCounts.open_known_present_recovered_accepted_slug ?? 0,
    knownPresentRecoveredNovelSlug:
      knownCounts.open_known_present_recovered_novel_slug ?? 0,
    knownPresentSuggestionOnly:
      knownCounts.open_known_present_suggestion_only ?? 0,
    knownPresentWrongValue:
      knownCounts.open_known_present_wrong_value ?? 0,
    knownPresentMissing:
      knownCounts.open_known_present_missing ?? 0,
    knownPresentConflict: knownPresent.filter((row) => row.conflict).length,
    activeValueRecoveryRate: rate(activeRecovered, knownPresent.length),
    valueRecoveryOrSuggestionRate: rate(recoveredOrSuggested, knownPresent.length),
    acceptedSlugRecoveryRate: rate(
      knownPresent.filter((row) => row.recoveredUnderAcceptedSlug).length,
      knownPresent.length,
    ),
    intentionallyMissingTotal: intentionallyMissing.length,
    missingAbsentCorrect: missingCounts.open_missing_absent_correct ?? 0,
    missingActiveValueHallucinated:
      missingCounts.open_missing_active_value_hallucinated ?? 0,
    missingActiveKeyHallucinated:
      missingCounts.open_missing_active_key_hallucinated ?? 0,
    missingActiveBothHallucinated:
      missingCounts.open_missing_active_hallucinated ?? 0,
    missingActiveHallucinatedTotal,
    missingAbstentionRate: rate(
      missingCounts.open_missing_absent_correct ?? 0,
      intentionallyMissing.length,
    ),
    ignoredMemoryPreferenceCount: ignoredMemoryPreferences.length,
    unscoredActivePreferenceCount: unscoredActivePreferences.length,
    unscoredSuggestionCount: unscoredSuggestions.length,
    duplicateSlugGroupCount: schemaDiagnostics.duplicateSlugGroups.length,
    emptyDescriptionDefinitionCount:
      schemaDiagnostics.emptyDescriptionDefinitions.length,
    missingDefinitionPreferenceCount:
      schemaDiagnostics.preferencesMissingDefinitions.length,
    missingDefinitionSuggestionCount:
      schemaDiagnostics.suggestionsMissingDefinitions.length,
    ownershipDecoyTotal: ownershipDecoyAudit.length,
    ownershipDecoyClean: ownershipCounts[OWNERSHIP_CLEAN] ?? 0,
    ownershipDecoyAllowedScoped:
      ownershipCounts[OWNERSHIP_ALLOWED_SCOPED] ?? 0,
    ownershipDecoyForbiddenActiveLeak:
      ownershipCounts[OWNERSHIP_FORBIDDEN_ACTIVE_LEAK] ?? 0,
    ownershipDecoyForbiddenSuggestionLeak:
      ownershipCounts[OWNERSHIP_FORBIDDEN_SUGGESTION_LEAK] ?? 0,
  };
}

function buildSchemaDiagnostics({ memorySnapshot }) {
  const definitions = memorySnapshot.definitions ?? [];
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const bySlug = new Map();
  for (const definition of definitions) {
    const rows = bySlug.get(definition.slug) ?? [];
    rows.push(definition);
    bySlug.set(definition.slug, rows);
  }

  return {
    definitionCount: definitions.length,
    activePreferenceCount: (memorySnapshot.preferences ?? []).filter(
      (preference) => preference.status === ACTIVE_STATUS,
    ).length,
    suggestionCount: memorySnapshot.suggestions?.length ?? 0,
    definitionBaseline: memorySnapshot.definitionBaseline,
    duplicateSlugGroups: [...bySlug.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([slug, rows]) => ({
        slug,
        count: rows.length,
        definitionIds: rows.map((row) => row.id).sort(),
        namespaces: unique(rows.map((row) => row.namespace)).sort(),
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug)),
    emptyDescriptionDefinitions: definitions
      .filter((definition) => definition.description === '')
      .map(definitionSummary)
      .sort(compareDefinitionSummaries),
    preferencesMissingDefinitions: (memorySnapshot.preferences ?? [])
      .filter((preference) => !definitionIds.has(preference.definitionId))
      .map(preferenceSummary)
      .sort(comparePreferenceSummaries),
    suggestionsMissingDefinitions: (memorySnapshot.suggestions ?? [])
      .filter((preference) => !definitionIds.has(preference.definitionId))
      .map(preferenceSummary)
      .sort(comparePreferenceSummaries),
  };
}

function countByClassification(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  }
  return counts;
}

function preferenceSummary(preference) {
  return {
    id: preference.id ?? null,
    slug: preference.slug,
    definitionId: preference.definitionId ?? null,
    value: preference.value,
    status: preference.status,
    sourceType: preference.sourceType ?? null,
    confidence: preference.confidence ?? null,
  };
}

function derivedPreferenceSummary({ factKey, value, sourceRows }) {
  return {
    id: null,
    slug: `derived.${factKey}`,
    definitionId: null,
    value,
    status: ACTIVE_STATUS,
    sourceType: `DERIVED:${sourceRows.map((row) => row.slug).join('+')}`,
    confidence: null,
  };
}

function sortPreferenceSummaries(rows) {
  return rows.sort(comparePreferenceSummaries);
}

function comparePreferenceSummaries(left, right) {
  return (
    left.slug.localeCompare(right.slug) ||
    String(left.definitionId ?? '').localeCompare(String(right.definitionId ?? '')) ||
    String(left.id ?? '').localeCompare(String(right.id ?? ''))
  );
}

function definitionSummary(definition) {
  return {
    id: definition.id,
    namespace: definition.namespace,
    slug: definition.slug,
    displayName: definition.displayName ?? null,
    ownerUserId: definition.ownerUserId ?? null,
    archivedAt: definition.archivedAt ?? null,
  };
}

function compareDefinitionSummaries(left, right) {
  return (
    left.slug.localeCompare(right.slug) ||
    left.namespace.localeCompare(right.namespace) ||
    left.id.localeCompare(right.id)
  );
}

function compareOwnershipDecoyRows(left, right) {
  return (
    left.ownerKey.localeCompare(right.ownerKey) ||
    left.valueLabel.localeCompare(right.valueLabel) ||
    String(left.value).localeCompare(String(right.value))
  );
}

export function collectOpenSchemaReportFactKeys(report) {
  return unique([
    ...(report.knownPresent ?? []).map((row) => row.factKey),
    ...(report.intentionallyMissing ?? []).map((row) => row.factKey),
  ]);
}
