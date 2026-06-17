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
    }),
    knownPresent,
    intentionallyMissing,
    schemaDiagnostics,
    ignoredMemoryPreferences,
    unscoredActivePreferences,
    unscoredSuggestions,
  };
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
}) {
  const knownCounts = countByClassification(knownPresent);
  const missingCounts = countByClassification(intentionallyMissing);
  const activeRecovered = knownPresent.filter(
    (row) => row.valueRecoveredInActiveMemory,
  ).length;
  const recoveredOrSuggested = knownPresent.filter(
    (row) => row.valueRecoveredInActiveMemory || row.suggestionOnly,
  ).length;
  const missingActiveHallucinated =
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
    missingActiveHallucinated,
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

export function collectOpenSchemaReportFactKeys(report) {
  return unique([
    ...(report.knownPresent ?? []).map((row) => row.factKey),
    ...(report.intentionallyMissing ?? []).map((row) => row.factKey),
  ]);
}
