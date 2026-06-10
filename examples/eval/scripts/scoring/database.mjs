import path from 'node:path';
import { collectFactKeys, getFactValue } from '../shared.mjs';
import { readJson, readYaml, validateWithSchema, writeJson } from './io.mjs';
import { isAbsentValue, rate, valueMatchesFact } from './normalize.mjs';
import { storageSpecForFact, unique } from './slugs.mjs';

const ACTIVE_STATUS = 'ACTIVE';

export async function scoreDatabaseToFile({
  repoRoot,
  userId,
  corpusId,
  storedPreferencesPath,
  validationReportPath,
  outPath,
}) {
  const report = await scoreDatabase({
    repoRoot,
    userId,
    corpusId,
    storedPreferencesPath,
    validationReportPath,
  });
  await validateWithSchema(
    repoRoot,
    'database-score-report.schema.json',
    report,
    'database score report',
  );
  await writeJson(outPath, report);
  return report;
}

export async function scoreDatabase({
  repoRoot,
  userId,
  corpusId,
  storedPreferencesPath,
  validationReportPath,
}) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', userId);
  const corpusRoot = path.join(userRoot, 'corpora', corpusId);
  const [profile, manifest, validationReport, storageMap, storedPreferences] =
    await Promise.all([
      readYaml(path.join(userRoot, 'profile.yaml')),
      readJson(path.join(corpusRoot, 'manifest.json')),
      readJson(validationReportPath ?? path.join(corpusRoot, 'validation-report.json')),
      readJson(path.join(evalRoot, 'scoring/fact-storage-map.v1.json')),
      readJson(storedPreferencesPath),
    ]);

  await validateWithSchema(
    repoRoot,
    'stored-preferences.schema.json',
    storedPreferences,
    'stored preferences',
  );

  if (storedPreferences.userId !== userId) {
    throw new Error(
      `stored-preferences userId ${storedPreferences.userId} does not match ${userId}`,
    );
  }
  if (storedPreferences.corpusId !== corpusId) {
    throw new Error(
      `stored-preferences corpusId ${storedPreferences.corpusId} does not match ${corpusId}`,
    );
  }

  const profileFacts = collectFactKeys(profile.facts ?? {});
  const fixtureReadiness = buildFixtureReadiness(validationReport);
  const activePreferences = (storedPreferences.preferences ?? []).filter(
    (preference) => preference.status === ACTIVE_STATUS,
  );
  const ignoredStoredPreferences = (storedPreferences.preferences ?? []).filter(
    (preference) => preference.status !== ACTIVE_STATUS,
  ).map(rowSummary);

  const knownFactKeys = fixtureReadiness.scorable
    ? collectKnownPresentFactKeys(validationReport, profileFacts)
    : [];
  const missingFactEntries = fixtureReadiness.scorable
    ? await collectMissingFactEntries({
        repoRoot,
        manifest,
        profileFacts,
      })
    : [];

  const usedPreferenceIndexes = new Set();
  const knownPresent = knownFactKeys.map((factKey) =>
    scoreKnownFact({
      factKey,
      profile,
      storageMap,
      activePreferences,
      usedPreferenceIndexes,
    }),
  );
  const intentionallyMissing = missingFactEntries.map((entry) =>
    scoreMissingFact({
      entry,
      profile,
      storageMap,
      activePreferences,
      usedPreferenceIndexes,
    }),
  );

  const unscoredStoredPreferences = activePreferences
    .filter((_preference, index) => !usedPreferenceIndexes.has(index))
    .map(rowSummary);

  return {
    schemaVersion: 1,
    scoreType: 'database-storage',
    userId,
    corpusId,
    storageInput: storedPreferences.storageInput,
    fixtureReadiness,
    summary: buildDatabaseSummary({
      knownPresent,
      intentionallyMissing,
      ignoredStoredPreferences,
      unscoredStoredPreferences,
    }),
    knownPresent,
    intentionallyMissing,
    ignoredStoredPreferences,
    unscoredStoredPreferences,
  };
}

export function buildFixtureReadiness(validationReport) {
  const blockingIssues = [];
  if (!validationReport) {
    blockingIssues.push({ reason: 'validation-report.json is missing' });
  } else {
    if (validationReport.status !== 'pass') {
      blockingIssues.push({ reason: `validation report status is ${validationReport.status}` });
    }
    const summary = validationReport.corpusTruth?.summary ?? {};
    if ((summary.hardFailures ?? 0) > 0) {
      blockingIssues.push({ reason: `corpusTruth has ${summary.hardFailures} hard failure(s)` });
    }
    if ((summary.unsupportedDeclaredFacts ?? 0) > 0) {
      blockingIssues.push({
        reason: 'corpusTruth has unsupported declared facts',
        factKeys: summary.unsupportedDeclaredFactKeys ?? [],
      });
    }
    if ((summary.factsMissing ?? 0) > 0) {
      blockingIssues.push({ reason: `corpusTruth has ${summary.factsMissing} missing declared fact(s)` });
    }
  }
  return {
    scorable: blockingIssues.length === 0,
    blockingIssues,
  };
}

function collectKnownPresentFactKeys(validationReport, profileFacts) {
  const proven = new Set();
  for (const doc of validationReport.corpusTruth?.documents ?? []) {
    for (const factKey of doc.declaredFacts?.provenPresent ?? []) {
      const value = profileFacts.leaves.get(factKey);
      if (value != null) proven.add(factKey);
    }
  }
  return [...proven].sort();
}

async function collectMissingFactEntries({ repoRoot, manifest, profileFacts }) {
  const entries = new Map();
  for (const missing of manifest.intentionallyMissing ?? []) {
    entries.set(missing.factKey, {
      factKey: missing.factKey,
      missingKind: missing.withheldValue == null
        ? 'profile_null_missing'
        : 'withheld_value_missing',
      withheldValue: missing.withheldValue ?? null,
      source: 'manifest.intentionallyMissing',
    });
  }

  for (const factKey of await collectProfileNullFormFactKeys({
    repoRoot,
    manifest,
    profileFacts,
  })) {
    if (!entries.has(factKey)) {
      entries.set(factKey, {
        factKey,
        missingKind: 'profile_null_missing',
        withheldValue: null,
        source: 'profile-null form field',
      });
    }
  }

  return [...entries.values()].sort((left, right) =>
    left.factKey.localeCompare(right.factKey),
  );
}

async function collectProfileNullFormFactKeys({ repoRoot, manifest, profileFacts }) {
  const factKeys = new Set();
  for (const formId of manifest.forms ?? []) {
    const fieldMapPath = path.join(
      repoRoot,
      'examples/eval/forms',
      formId,
      'field-map.json',
    );
    let fieldMap;
    try {
      fieldMap = await readJson(fieldMapPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const field of fieldMap.fields ?? []) {
      if (field.mode !== 'fact') continue;
      if (profileFacts.leaves.get(field.factKey) === null) {
        factKeys.add(field.factKey);
      }
    }
  }
  return [...factKeys];
}

function scoreKnownFact({
  factKey,
  profile,
  storageMap,
  activePreferences,
  usedPreferenceIndexes,
}) {
  const expectedValue = getFactValue(profile.facts ?? {}, factKey);
  const storage = storageSpecForFact(factKey, { profile, storageMap });
  const accepted = new Set(storage.acceptedSlugs);
  const matchingRows = [];
  const acceptedSlugRows = [];
  const acceptedCorrectRows = [];
  const acceptedWrongRows = [];

  activePreferences.forEach((preference, index) => {
    const matches = valueMatchesFact(factKey, expectedValue, preference.value);
    if (matches) {
      matchingRows.push(rowSummary(preference));
      usedPreferenceIndexes.add(index);
    }
    if (accepted.has(preference.slug)) {
      acceptedSlugRows.push(rowSummary(preference));
      usedPreferenceIndexes.add(index);
      if (matches) {
        acceptedCorrectRows.push(rowSummary(preference));
      } else if (!isAbsentValue(preference.value)) {
        acceptedWrongRows.push(rowSummary(preference));
      }
    }
  });

  const expectedValueFoundAnywhere = matchingRows.length > 0;
  const expectedValueFoundUnderAcceptedSlug = acceptedCorrectRows.length > 0;
  const acceptedSlugPopulated = acceptedSlugRows.some(
    (row) => !isAbsentValue(row.value),
  );
  const acceptedSlugHasWrongValue = acceptedWrongRows.length > 0;
  const canonicalSlugCorrect = acceptedCorrectRows.some((row) =>
    storage.canonicalSlugs.includes(row.slug),
  );
  const acceptedAliasCorrect = acceptedCorrectRows.some((row) =>
    storage.acceptedAliasSlugs.includes(row.slug),
  );

  return {
    factKey,
    expectedValue,
    canonicalSlugs: storage.canonicalSlugs,
    acceptedAliasSlugs: storage.acceptedAliasSlugs,
    expectedValueFoundAnywhere,
    expectedValueFoundUnderAcceptedSlug,
    acceptedSlugPopulated,
    acceptedSlugHasWrongValue,
    canonicalSlugCorrect,
    acceptedAliasCorrect,
    matchingRows,
    acceptedSlugRows,
    classification: classifyKnown({
      expectedValueFoundAnywhere,
      expectedValueFoundUnderAcceptedSlug,
      acceptedSlugHasWrongValue,
    }),
  };
}

function classifyKnown({
  expectedValueFoundAnywhere,
  expectedValueFoundUnderAcceptedSlug,
  acceptedSlugHasWrongValue,
}) {
  if (expectedValueFoundUnderAcceptedSlug && acceptedSlugHasWrongValue) {
    return 'known_present_conflict';
  }
  if (expectedValueFoundUnderAcceptedSlug) return 'known_present_correct';
  if (expectedValueFoundAnywhere) return 'known_present_wrong_slug';
  if (acceptedSlugHasWrongValue) return 'known_present_wrong_value';
  return 'known_present_missing';
}

export function scoreMissingFact({
  entry,
  profile,
  storageMap,
  activePreferences,
  usedPreferenceIndexes,
}) {
  const storage = storageSpecForFact(entry.factKey, { profile, storageMap });
  const accepted = new Set(storage.acceptedSlugs);
  const acceptedSlugRows = [];
  const valueRows = [];

  activePreferences.forEach((preference, index) => {
    if (accepted.has(preference.slug)) {
      acceptedSlugRows.push(rowSummary(preference));
      usedPreferenceIndexes.add(index);
    }
    if (
      entry.withheldValue != null &&
      valueMatchesFact(entry.factKey, entry.withheldValue, preference.value)
    ) {
      valueRows.push(rowSummary(preference));
      usedPreferenceIndexes.add(index);
    }
  });

  const valueFoundAnywhere = valueRows.length > 0;
  const acceptedSlugHasValue = acceptedSlugRows.some(
    (row) => !isAbsentValue(row.value),
  );

  return {
    factKey: entry.factKey,
    missingKind: entry.missingKind,
    withheldValue: entry.withheldValue,
    source: entry.source,
    canonicalSlugs: storage.canonicalSlugs,
    acceptedAliasSlugs: storage.acceptedAliasSlugs,
    valueFoundAnywhere,
    acceptedSlugHasValue,
    valueRows,
    acceptedSlugRows,
    classification: classifyMissing({ valueFoundAnywhere, acceptedSlugHasValue }),
  };
}

function classifyMissing({ valueFoundAnywhere, acceptedSlugHasValue }) {
  if (valueFoundAnywhere && acceptedSlugHasValue) return 'missing_hallucinated';
  if (valueFoundAnywhere) return 'missing_value_hallucinated';
  if (acceptedSlugHasValue) return 'missing_key_hallucinated';
  return 'missing_absent_correct';
}

function buildDatabaseSummary({
  knownPresent,
  intentionallyMissing,
  ignoredStoredPreferences,
  unscoredStoredPreferences,
}) {
  const knownCounts = countByClassification(knownPresent);
  const missingCounts = countByClassification(intentionallyMissing);
  const knownPresentCorrect = knownCounts.known_present_correct ?? 0;
  const missingHallucinated =
    (missingCounts.missing_hallucinated ?? 0) +
    (missingCounts.missing_value_hallucinated ?? 0) +
    (missingCounts.missing_key_hallucinated ?? 0);

  return {
    knownPresentTotal: knownPresent.length,
    knownPresentCorrect,
    knownPresentWrongSlug: knownCounts.known_present_wrong_slug ?? 0,
    knownPresentWrongValue: knownCounts.known_present_wrong_value ?? 0,
    knownPresentConflict: knownCounts.known_present_conflict ?? 0,
    knownPresentMissing: knownCounts.known_present_missing ?? 0,
    valueRecoveryRate: rate(
      knownPresent.filter((fact) => fact.expectedValueFoundAnywhere).length,
      knownPresent.length,
    ),
    acceptedSlugAccuracy: rate(knownPresentCorrect, knownPresent.length),
    acceptedSlugRecoveryRate: rate(
      knownPresent.filter((fact) => fact.expectedValueFoundUnderAcceptedSlug)
        .length,
      knownPresent.length,
    ),
    intentionallyMissingTotal: intentionallyMissing.length,
    missingAbsentCorrect: missingCounts.missing_absent_correct ?? 0,
    missingHallucinated,
    missingAbstentionRate: rate(
      missingCounts.missing_absent_correct ?? 0,
      intentionallyMissing.length,
    ),
    ignoredStoredPreferenceCount: ignoredStoredPreferences.length,
    unscoredStoredPreferenceCount: unscoredStoredPreferences.length,
  };
}

function countByClassification(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  }
  return counts;
}

function rowSummary(preference) {
  return {
    slug: preference.slug,
    value: preference.value,
    status: preference.status,
    sourceType: preference.sourceType ?? null,
    confidence: preference.confidence ?? null,
  };
}

export function collectReportFactKeys(report) {
  return unique([
    ...(report.knownPresent ?? []).map((row) => row.factKey),
    ...(report.intentionallyMissing ?? []).map((row) => row.factKey),
  ]);
}
