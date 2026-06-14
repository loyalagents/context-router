import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scoreCombined } from './combined.mjs';
import { validateWithSchema } from './io.mjs';
import { jsonText } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');

test('combined scorer joins storage and form rows by fact key', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-combined-'));
  const databaseReportPath = path.join(tmp, 'database-score-report.json');
  const formReportPath = path.join(tmp, 'form-fill-score-report.json');
  await writeFile(databaseReportPath, jsonText(databaseReport()));
  await writeFile(formReportPath, jsonText(formReport()));

  const report = await scoreCombined({
    repoRoot,
    databaseReportPath,
    formReportPath,
  });

  assert.equal(stage(report, 'identity.legalName'), 'stored_correct_form_correct');
  assert.equal(stage(report, 'identity.firstName'), 'stored_correct_form_wrong');
  assert.equal(stage(report, 'identity.lastName'), 'stored_wrong_slug_form_missing');
  assert.equal(stage(report, 'identity.ssn'), 'stored_missing_form_hallucinated');
  assert.equal(stage(report, 'contact.phone'), 'missing_absent_form_absent');
  await validateWithSchema(
    repoRoot,
    'combined-score-report.schema.json',
    report,
    'combined score report',
  );
});

test('combined scorer rejects mismatched user and corpus reports', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-combined-mismatch-'));
  const databaseReportPath = path.join(tmp, 'database-score-report.json');
  const formReportPath = path.join(tmp, 'form-fill-score-report.json');

  await writeFile(databaseReportPath, jsonText(databaseReport()));
  await writeFile(
    formReportPath,
    jsonText({ ...formReport(), userId: 'different-user' }),
  );
  await assert.rejects(
    scoreCombined({ repoRoot, databaseReportPath, formReportPath }),
    /different userId/,
  );

  await writeFile(
    formReportPath,
    jsonText({ ...formReport(), corpusId: 'different-corpus' }),
  );
  await assert.rejects(
    scoreCombined({ repoRoot, databaseReportPath, formReportPath }),
    /different corpusId/,
  );
});

test('combined scorer keeps conflict attribution distinct from clean correctness', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-combined-conflict-'));
  const databaseReportPath = path.join(tmp, 'database-score-report.json');
  const formReportPath = path.join(tmp, 'form-fill-score-report.json');
  await writeFile(
    databaseReportPath,
    jsonText({
      ...databaseReport(),
      knownPresent: [known('identity.legalName', 'known_present_conflict')],
    }),
  );
  await writeFile(
    formReportPath,
    jsonText({
      ...formReport(),
      fields: [field('identity.legalName', 'form_known_correct')],
    }),
  );

  const report = await scoreCombined({
    repoRoot,
    databaseReportPath,
    formReportPath,
  });

  assert.equal(stage(report, 'identity.legalName'), 'stored_conflict_form_correct');
  assert.equal(
    report.summary.stageAttributionCounts.stored_conflict_form_correct,
    1,
  );
});

function stage(report, factKey) {
  return report.facts.find((fact) => fact.factKey === factKey).stageAttribution;
}

function databaseReport() {
  return {
    schemaVersion: 1,
    scoreType: 'database-storage',
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    storageInput: { statusesScored: ['ACTIVE'] },
    fixtureReadiness: { scorable: true, blockingIssues: [] },
    summary: databaseSummary(),
    knownPresent: [
      known('identity.legalName', 'known_present_correct'),
      known('identity.firstName', 'known_present_correct'),
      known('identity.lastName', 'known_present_wrong_slug'),
      known('identity.ssn', 'known_present_missing'),
    ],
    intentionallyMissing: [
      {
        factKey: 'contact.phone',
        missingKind: 'profile_null_missing',
        withheldValue: null,
        source: 'manifest.intentionallyMissing',
        canonicalSlugs: ['profile.phone_number'],
        acceptedAliasSlugs: ['contact.phone'],
        valueFoundAnywhere: false,
        acceptedSlugHasValue: false,
        valueRows: [],
        acceptedSlugRows: [],
        classification: 'missing_absent_correct',
      },
    ],
    ignoredStoredPreferences: [],
    unscoredStoredPreferences: [],
  };
}

function known(factKey, classification) {
  const isCorrect = classification === 'known_present_correct';
  const isWrongSlug = classification === 'known_present_wrong_slug';
  const isWrongValue = classification === 'known_present_wrong_value';
  const isConflict = classification === 'known_present_conflict';
  const isMissing = classification === 'known_present_missing';
  const acceptedCorrect = isCorrect || isConflict;
  const matchingRows =
    isMissing || isWrongValue ? [] : [preference('profile.test', 'value')];
  const acceptedSlugRows =
    isMissing || isWrongSlug
      ? []
      : [
          preference(
            'profile.test',
            isWrongValue || isConflict ? 'wrong value' : 'value',
          ),
        ];

  return {
    factKey,
    expectedValue: 'value',
    canonicalSlugs: ['profile.test'],
    acceptedAliasSlugs: [],
    expectedValueFoundAnywhere: matchingRows.length > 0,
    expectedValueFoundUnderAcceptedSlug: acceptedCorrect,
    acceptedSlugPopulated: !isMissing && !isWrongSlug,
    acceptedSlugHasWrongValue: isWrongValue || isConflict,
    canonicalSlugCorrect: acceptedCorrect,
    acceptedAliasCorrect: false,
    matchingRows,
    acceptedSlugRows,
    classification,
  };
}

function formReport() {
  return {
    schemaVersion: 1,
    scoreType: 'form-fill',
    scenarioId: 'alex-i9-realistic',
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    formId: 'i-9',
    summary: formSummary(),
    fields: [
      field('identity.legalName', 'form_known_correct'),
      field('identity.firstName', 'form_known_wrong'),
      field('identity.lastName', 'form_known_missing'),
      field('identity.ssn', 'form_missing_hallucinated'),
      field('contact.phone', 'form_missing_absent_correct'),
    ],
  };
}

function field(factKey, classification) {
  return {
    fieldIndex: 0,
    pdfFieldName: factKey,
    factKey,
    fieldClass: 'should-fill',
    expectedAction: 'SET_TEXT',
    expectedValue: 'value',
    actualValue: classification,
    sourceSlugs: [],
    sourceSlugAgrees: false,
    snapshotClassification: 'correct',
    classification,
    overfill: false,
    overfillSeverity: null,
    overfillReason: null,
  };
}

function preference(slug, value) {
  return {
    slug,
    value,
    status: 'ACTIVE',
    sourceType: 'INFERRED',
    confidence: 0.9,
  };
}

function databaseSummary() {
  return {
    knownPresentTotal: 4,
    knownPresentCorrect: 2,
    knownPresentWrongSlug: 1,
    knownPresentWrongValue: 0,
    knownPresentConflict: 0,
    knownPresentMissing: 1,
    valueRecoveryRate: 0.75,
    acceptedSlugAccuracy: 0.5,
    acceptedSlugRecoveryRate: 0.5,
    intentionallyMissingTotal: 1,
    missingAbsentCorrect: 1,
    missingHallucinated: 0,
    missingAbstentionRate: 1,
    ignoredStoredPreferenceCount: 0,
    unscoredStoredPreferenceCount: 0,
  };
}

function formSummary() {
  return {
    knownFieldTotal: 4,
    knownFieldCorrect: 1,
    knownFieldMissing: 1,
    knownFieldWrong: 1,
    knownFieldAccuracy: 0.25,
    knownFieldMissingRate: 0.25,
    knownFieldWrongRate: 0.25,
    abstentionFieldTotal: 1,
    abstentionFieldAbsentCorrect: 1,
    abstentionFieldHallucinated: 0,
    missingFieldAbstentionRate: 1,
    missingFieldHallucinationRate: 0,
    structuralSkipCount: 0,
    structuralOverfillCount: 0,
    manualAttestationOverfillCount: 0,
    outOfScopeOverfillCount: 0,
    unmappedOverfillCount: 0,
    unsupportedFieldCount: 0,
    sourceSlugAgreementRate: 0,
  };
}
