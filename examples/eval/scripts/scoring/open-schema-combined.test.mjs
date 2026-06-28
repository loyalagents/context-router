import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scoreOpenSchemaCombinedToFile } from './open-schema-combined.mjs';
import { jsonText } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');

test('open-schema combined scorer joins memory recovery with form outcomes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-open-combined-'));
  const databaseReportPath = path.join(tmp, 'open-schema-database-score-report.json');
  const formReportPath = path.join(tmp, 'form-fill-score-report.json');
  const combinedReportPath = path.join(tmp, 'open-schema-combined-score-report.json');

  await writeFile(
    databaseReportPath,
    jsonText(
      openDatabaseReport({
        knownPresent: [
          knownRow(
            'identity.legalName',
            'open_known_present_recovered_accepted_slug',
            {
              valueRecoveredInActiveMemory: true,
              recoveredUnderAcceptedSlug: true,
              matchingAcceptedRows: [preferenceSummary('profile.full_name')],
            },
          ),
          knownRow('identity.firstName', 'open_known_present_missing'),
          knownRow('identity.lastName', 'open_known_present_suggestion_only', {
            suggestionOnly: true,
            matchingSuggestionRows: [preferenceSummary('agent.identity.family_name')],
          }),
          knownRow('contact.email', 'open_known_present_wrong_value', {
            acceptedSlugHasWrongValue: true,
            acceptedWrongRows: [preferenceSummary('profile.email')],
          }),
        ],
        intentionallyMissing: [
          missingRow('contact.phone', 'open_missing_absent_correct'),
          missingRow('identity.ssn', 'open_missing_active_key_hallucinated', {
            activeAcceptedSlugHasValue: true,
            activeAcceptedSlugRows: [preferenceSummary('identity.ssn')],
          }),
        ],
      }),
    ),
  );
  await writeFile(
    formReportPath,
    jsonText(
      formReport([
        formField('identity.legalName', 'form_known_correct', 'Alex Jordan Rivera'),
        formField('identity.firstName', 'form_known_missing', null),
        formField('identity.lastName', 'form_known_correct', 'Rivera'),
        formField('contact.email', 'form_known_wrong', 'wrong@example.test'),
        formField('contact.phone', 'form_missing_absent_correct', null, {
          fieldClass: 'abstention-test',
          expectedAction: 'SKIP',
          snapshotClassification: 'skipped-correctly',
        }),
        formField('identity.ssn', 'form_missing_hallucinated', '000-00-0292', {
          fieldClass: 'abstention-test',
          expectedAction: 'SKIP',
          snapshotClassification: 'hallucinated',
        }),
        formField('employment.company', 'form_known_correct', 'Cascadia Hiring Cooperative'),
      ]),
    ),
  );

  const report = await scoreOpenSchemaCombinedToFile({
    repoRoot,
    openSchemaDatabaseReportPath: databaseReportPath,
    formReportPath,
    outPath: combinedReportPath,
  });
  const written = JSON.parse(await readFile(combinedReportPath, 'utf8'));

  assert.equal(written.scoreType, 'open-schema-combined');
  assert.equal(report.summary.factTotal, 7);
  assert.equal(
    fact(report, 'identity.legalName').stageAttribution,
    'open_memory_recovered_form_correct',
  );
  assert.equal(
    fact(report, 'identity.firstName').stageAttribution,
    'open_memory_missing_form_missing',
  );
  assert.equal(
    fact(report, 'identity.lastName').stageAttribution,
    'open_memory_suggestion_only_form_correct',
  );
  assert.equal(
    fact(report, 'contact.email').stageAttribution,
    'open_memory_wrong_value_form_wrong',
  );
  assert.equal(
    fact(report, 'contact.phone').stageAttribution,
    'open_missing_absent_form_absent',
  );
  assert.equal(
    fact(report, 'identity.ssn').stageAttribution,
    'open_missing_hallucinated_form_hallucinated',
  );
  assert.equal(
    fact(report, 'employment.company').stageAttribution,
    'open_memory_not_scored_form_correct',
  );
  assert.equal(fact(report, 'employment.company').memory, null);
  assert.equal(report.summary.formCorrectWithRecoveredMemory, 1);
  assert.equal(report.summary.formCorrectWithoutRecoveredMemory, 2);
  assert.equal(report.summary.memoryStatusCounts.recovered, 1);
  assert.equal(report.summary.memoryStatusCounts.suggestion_only, 1);
  assert.equal(report.summary.formStatusCounts.correct, 3);
});

test('open-schema combined scorer rejects mismatched user and corpus reports', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-open-combined-invalid-'));
  const databaseReportPath = path.join(tmp, 'open-schema-database-score-report.json');
  const userMismatchFormPath = path.join(tmp, 'user-form-fill-score-report.json');
  const corpusMismatchFormPath = path.join(tmp, 'corpus-form-fill-score-report.json');
  await writeFile(databaseReportPath, jsonText(openDatabaseReport()));
  await writeFile(
    userMismatchFormPath,
    jsonText(formReport([], { userId: 'other-user' })),
  );
  await writeFile(
    corpusMismatchFormPath,
    jsonText(formReport([], { corpusId: 'other-corpus' })),
  );

  await assert.rejects(
    scoreOpenSchemaCombinedToFile({
      repoRoot,
      openSchemaDatabaseReportPath: databaseReportPath,
      formReportPath: userMismatchFormPath,
      outPath: path.join(tmp, 'user-combined.json'),
    }),
    /different userId values/,
  );
  await assert.rejects(
    scoreOpenSchemaCombinedToFile({
      repoRoot,
      openSchemaDatabaseReportPath: databaseReportPath,
      formReportPath: corpusMismatchFormPath,
      outPath: path.join(tmp, 'corpus-combined.json'),
    }),
    /different corpusId values/,
  );
});

function openDatabaseReport({ knownPresent = [], intentionallyMissing = [] } = {}) {
  return {
    schemaVersion: 1,
    scoreType: 'open-schema-database-storage',
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    storageInput: {
      schemaMode: 'open',
      producer: 'unit-test',
      statusesScored: ['ACTIVE'],
      suggestionsWereAutoApplied: false,
    },
    memorySnapshot: {
      runId: 'run-open-combined-test',
      evaluationMode: 'open-schema-static',
      diagnostics: {},
    },
    fixtureReadiness: {
      scorable: true,
      blockingIssues: [],
    },
    summary: openDatabaseSummary({ knownPresent, intentionallyMissing }),
    knownPresent,
    intentionallyMissing,
    ownershipDecoyAudit: [],
    schemaDiagnostics: {
      definitionCount: 0,
      activePreferenceCount: 0,
      suggestionCount: 0,
      definitionBaseline: {},
      duplicateSlugGroups: [],
      emptyDescriptionDefinitions: [],
      preferencesMissingDefinitions: [],
      suggestionsMissingDefinitions: [],
    },
    ignoredMemoryPreferences: [],
    unscoredActivePreferences: [],
    unscoredSuggestions: [],
  };
}

function openDatabaseSummary({ knownPresent, intentionallyMissing }) {
  return {
    knownPresentTotal: knownPresent.length,
    knownPresentRecoveredActive: knownPresent.filter(
      (row) => row.valueRecoveredInActiveMemory,
    ).length,
    knownPresentRecoveredAcceptedSlug: knownPresent.filter(
      (row) => row.classification === 'open_known_present_recovered_accepted_slug',
    ).length,
    knownPresentRecoveredNovelSlug: knownPresent.filter(
      (row) => row.classification === 'open_known_present_recovered_novel_slug',
    ).length,
    knownPresentSuggestionOnly: knownPresent.filter(
      (row) => row.classification === 'open_known_present_suggestion_only',
    ).length,
    knownPresentWrongValue: knownPresent.filter(
      (row) => row.classification === 'open_known_present_wrong_value',
    ).length,
    knownPresentMissing: knownPresent.filter(
      (row) => row.classification === 'open_known_present_missing',
    ).length,
    knownPresentConflict: knownPresent.filter((row) => row.conflict).length,
    activeValueRecoveryRate: null,
    valueRecoveryOrSuggestionRate: null,
    acceptedSlugRecoveryRate: null,
    intentionallyMissingTotal: intentionallyMissing.length,
    missingAbsentCorrect: intentionallyMissing.filter(
      (row) => row.classification === 'open_missing_absent_correct',
    ).length,
    missingActiveValueHallucinated: intentionallyMissing.filter(
      (row) => row.classification === 'open_missing_active_value_hallucinated',
    ).length,
    missingActiveKeyHallucinated: intentionallyMissing.filter(
      (row) => row.classification === 'open_missing_active_key_hallucinated',
    ).length,
    missingActiveBothHallucinated: intentionallyMissing.filter(
      (row) => row.classification === 'open_missing_active_hallucinated',
    ).length,
    missingActiveHallucinatedTotal: intentionallyMissing.filter((row) =>
      row.classification.startsWith('open_missing_active_'),
    ).length,
    missingAbstentionRate: null,
    ignoredMemoryPreferenceCount: 0,
    unscoredActivePreferenceCount: 0,
    unscoredSuggestionCount: 0,
    duplicateSlugGroupCount: 0,
    emptyDescriptionDefinitionCount: 0,
    missingDefinitionPreferenceCount: 0,
    missingDefinitionSuggestionCount: 0,
    ownershipDecoyTotal: 0,
    ownershipDecoyClean: 0,
    ownershipDecoyAllowedScoped: 0,
    ownershipDecoyForbiddenActiveLeak: 0,
    ownershipDecoyForbiddenSuggestionLeak: 0,
  };
}

function knownRow(factKey, classification, overrides = {}) {
  return {
    factKey,
    expectedValue: overrides.expectedValue ?? `expected ${factKey}`,
    canonicalSlugs: [`${factKey}.canonical`],
    acceptedAliasSlugs: [`${factKey}.alias`],
    valueRecoveredInActiveMemory: overrides.valueRecoveredInActiveMemory ?? false,
    recoveredUnderAcceptedSlug: overrides.recoveredUnderAcceptedSlug ?? false,
    recoveredUnderNovelSlug: overrides.recoveredUnderNovelSlug ?? false,
    suggestionOnly: overrides.suggestionOnly ?? false,
    acceptedSlugPopulated: overrides.acceptedSlugPopulated ?? false,
    acceptedSlugHasWrongValue: overrides.acceptedSlugHasWrongValue ?? false,
    conflict: overrides.conflict ?? false,
    matchingActiveRows: overrides.matchingActiveRows ?? [],
    matchingAcceptedRows: overrides.matchingAcceptedRows ?? [],
    matchingNovelRows: overrides.matchingNovelRows ?? [],
    acceptedSlugRows: overrides.acceptedSlugRows ?? [],
    acceptedWrongRows: overrides.acceptedWrongRows ?? [],
    matchingSuggestionRows: overrides.matchingSuggestionRows ?? [],
    classification,
  };
}

function missingRow(factKey, classification, overrides = {}) {
  return {
    factKey,
    missingKind: overrides.missingKind ?? 'profile_null_missing',
    withheldValue: overrides.withheldValue ?? null,
    source: overrides.source ?? 'manifest',
    canonicalSlugs: [`${factKey}.canonical`],
    acceptedAliasSlugs: [`${factKey}.alias`],
    activeValueFoundAnywhere: overrides.activeValueFoundAnywhere ?? false,
    activeAcceptedSlugHasValue: overrides.activeAcceptedSlugHasValue ?? false,
    suggestionValueFoundAnywhere: overrides.suggestionValueFoundAnywhere ?? false,
    suggestionAcceptedSlugHasValue: overrides.suggestionAcceptedSlugHasValue ?? false,
    activeValueRows: overrides.activeValueRows ?? [],
    activeAcceptedSlugRows: overrides.activeAcceptedSlugRows ?? [],
    suggestionValueRows: overrides.suggestionValueRows ?? [],
    suggestionAcceptedSlugRows: overrides.suggestionAcceptedSlugRows ?? [],
    classification,
  };
}

function preferenceSummary(slug) {
  return {
    id: `pref-${slug.replace(/[^a-z0-9]+/gi, '-')}`,
    slug,
    definitionId: `def-${slug.replace(/[^a-z0-9]+/gi, '-')}`,
    value: 'value',
    status: 'ACTIVE',
    sourceType: 'INFERRED',
    confidence: 0.9,
  };
}

function formReport(fields, overrides = {}) {
  return {
    schemaVersion: 1,
    scoreType: 'form-fill',
    scenarioId: overrides.scenarioId ?? 'alex-i9-realistic',
    userId: overrides.userId ?? 'alex-i9-test',
    corpusId: overrides.corpusId ?? 'realistic',
    formId: overrides.formId ?? 'i-9',
    summary: formSummary(fields),
    fields,
  };
}

function formField(factKey, classification, actualValue, overrides = {}) {
  return {
    fieldIndex: overrides.fieldIndex ?? FORM_FIELD_INDEX++,
    pdfFieldName: overrides.pdfFieldName ?? factKey,
    factKey,
    fieldClass: overrides.fieldClass ?? 'should-fill',
    expectedAction: overrides.expectedAction ?? 'SET_TEXT',
    expectedValue: overrides.expectedValue ?? `expected ${factKey}`,
    actualValue,
    sourceSlugs: overrides.sourceSlugs ?? [],
    sourceSlugAgrees: overrides.sourceSlugAgrees ?? false,
    snapshotClassification:
      overrides.snapshotClassification ?? snapshotClassificationFor(classification),
    classification,
    overfill: overrides.overfill ?? false,
    overfillSeverity: overrides.overfillSeverity ?? null,
    overfillReason: overrides.overfillReason ?? null,
  };
}

let FORM_FIELD_INDEX = 0;

function snapshotClassificationFor(classification) {
  if (classification === 'form_known_correct') return 'correct';
  if (classification === 'form_known_missing') return 'missing';
  if (classification === 'form_known_wrong') return 'incorrect';
  if (classification === 'form_missing_absent_correct') return 'skipped-correctly';
  if (classification === 'form_missing_hallucinated') return 'hallucinated';
  if (classification === 'structural_overfilled') return 'hallucinated';
  if (classification === 'unsupported') return 'unsupported';
  return 'correct';
}

function formSummary(fields) {
  const known = fields.filter((field) => field.fieldClass === 'should-fill');
  const abstention = fields.filter((field) => field.fieldClass === 'abstention-test');
  const knownCorrect = known.filter(
    (field) => field.classification === 'form_known_correct',
  ).length;
  const knownMissing = known.filter(
    (field) => field.classification === 'form_known_missing',
  ).length;
  const knownWrong = known.filter(
    (field) => field.classification === 'form_known_wrong',
  ).length;
  const abstentionAbsent = abstention.filter(
    (field) => field.classification === 'form_missing_absent_correct',
  ).length;
  const abstentionHallucinated = abstention.filter(
    (field) => field.classification === 'form_missing_hallucinated',
  ).length;
  return {
    knownFieldTotal: known.length,
    knownFieldCorrect: knownCorrect,
    knownFieldMissing: knownMissing,
    knownFieldWrong: knownWrong,
    knownFieldAccuracy: known.length ? knownCorrect / known.length : null,
    knownFieldMissingRate: known.length ? knownMissing / known.length : null,
    knownFieldWrongRate: known.length ? knownWrong / known.length : null,
    abstentionFieldTotal: abstention.length,
    abstentionFieldAbsentCorrect: abstentionAbsent,
    abstentionFieldHallucinated: abstentionHallucinated,
    missingFieldAbstentionRate: abstention.length
      ? abstentionAbsent / abstention.length
      : null,
    missingFieldHallucinationRate: abstention.length
      ? abstentionHallucinated / abstention.length
      : null,
    structuralSkipCount: fields.filter((field) => field.fieldClass === 'structural-skip').length,
    structuralOverfillCount: fields.filter((field) => field.overfill).length,
    manualAttestationOverfillCount: 0,
    outOfScopeOverfillCount: 0,
    unmappedOverfillCount: 0,
    unsupportedFieldCount: fields.filter((field) => field.fieldClass === 'unsupported').length,
    sourceSlugAgreementRate: knownCorrect ? 0 : null,
  };
}

function fact(report, factKey) {
  return report.facts.find((candidate) => candidate.factKey === factKey);
}
