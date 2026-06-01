import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildFixtureReadiness,
  scoreDatabase,
  scoreMissingFact,
} from './database.mjs';
import { validateWithSchema } from './io.mjs';
import { jsonText } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');

test('database scorer classifies canonical, alias, wrong slug, wrong value, conflict, missing, ignored, and extras', async () => {
  const artifactPath = await writeStoredPreferences([
    pref('profile.full_name', 'Alex Jordan Rivera'),
    pref('identity.ssn', '000000292'),
    pref('unexpected.date_of_birth', '03/14/1992'),
    pref('eval.identity.first_name', 'Alyx'),
    pref('eval.identity.last_name', 'Rivera'),
    pref('profile.last_name', 'Rivera-Wrong'),
    pref('contact.phone', ''),
    pref('housing.pet_policy', 'No cats'),
    pref('eval.identity.middle_initial', 'J', 'SUGGESTED'),
  ]);

  const report = await scoreDatabase({
    repoRoot,
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    storedPreferencesPath: artifactPath,
  });

  assert.equal(report.fixtureReadiness.scorable, true);
  await validateWithSchema(
    repoRoot,
    'database-score-report.schema.json',
    report,
    'database score report',
  );
  assert.equal(row(report, 'identity.legalName').classification, 'known_present_correct');
  assert.equal(row(report, 'identity.ssn').classification, 'known_present_correct');
  assert.equal(row(report, 'identity.ssn').canonicalSlugCorrect, false);
  assert.equal(row(report, 'identity.ssn').acceptedAliasCorrect, true);
  assert.equal(row(report, 'identity.dateOfBirth').classification, 'known_present_wrong_slug');
  assert.equal(row(report, 'identity.firstName').classification, 'known_present_wrong_value');
  assert.equal(row(report, 'identity.lastName').classification, 'known_present_conflict');
  assert.equal(row(report, 'identity.middleInitial').classification, 'known_present_missing');
  assert.equal(missingRow(report, 'contact.phone').classification, 'missing_absent_correct');
  assert.equal(
    report.summary.knownPresentCorrect,
    report.knownPresent.filter(
      (candidate) => candidate.classification === 'known_present_correct',
    ).length,
  );
  assert.ok(report.summary.acceptedSlugRecoveryRate > report.summary.acceptedSlugAccuracy);
  assert.equal(report.ignoredStoredPreferences.length, 1);
  assert.deepEqual(
    report.unscoredStoredPreferences.map((preference) => preference.slug),
    ['housing.pet_policy'],
  );
});

test('database scorer rejects stored-preferences artifacts that do not declare active-only scoring', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-db-status-'));
  const artifactPath = path.join(tmp, 'stored-preferences.json');
  await writeFile(
    artifactPath,
    jsonText({
      schemaVersion: 1,
      artifactType: 'stored-preferences',
      userId: 'alex-i9-test',
      corpusId: 'realistic',
      storageInput: { statusesScored: ['ACTIVE', 'SUGGESTED'] },
      preferences: [],
    }),
  );

  await assert.rejects(
    scoreDatabase({
      repoRoot,
      userId: 'alex-i9-test',
      corpusId: 'realistic',
      storedPreferencesPath: artifactPath,
    }),
    /stored preferences failed stored-preferences.schema.json/,
  );
});

test('database scorer flags missing accepted key population', async () => {
  const artifactPath = await writeStoredPreferences([
    pref('contact.phone', '503-555-0199'),
  ]);

  const report = await scoreDatabase({
    repoRoot,
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    storedPreferencesPath: artifactPath,
  });

  assert.equal(missingRow(report, 'contact.phone').classification, 'missing_key_hallucinated');
});

test('database scorer treats null and empty accepted missing keys as absent', async () => {
  for (const value of [null, '']) {
    const artifactPath = await writeStoredPreferences([
      pref('contact.phone', value),
    ]);

    const report = await scoreDatabase({
      repoRoot,
      userId: 'alex-i9-test',
      corpusId: 'realistic',
      storedPreferencesPath: artifactPath,
    });

    assert.equal(missingRow(report, 'contact.phone').classification, 'missing_absent_correct');
  }
});

test('database scorer rejects schema-invalid stored-preferences artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-db-invalid-'));
  const artifactPath = path.join(tmp, 'stored-preferences.json');
  await writeFile(artifactPath, jsonText({ schemaVersion: 1 }));

  await assert.rejects(
    scoreDatabase({
      repoRoot,
      userId: 'alex-i9-test',
      corpusId: 'realistic',
      storedPreferencesPath: artifactPath,
    }),
    /stored preferences failed stored-preferences.schema.json/,
  );
});

test('fixture readiness blocks hard corpus-truth failures', () => {
  const readiness = buildFixtureReadiness({
    status: 'fail',
    corpusTruth: {
      summary: {
        hardFailures: 1,
        unsupportedDeclaredFacts: 1,
        unsupportedDeclaredFactKeys: ['identity.ssn'],
        factsMissing: 1,
      },
    },
  });

  assert.equal(readiness.scorable, false);
  assert.equal(readiness.blockingIssues.length, 4);
});

test('missing fact scoring detects withheld value leaks', () => {
  const row = scoreMissingFact({
    entry: {
      factKey: 'contact.phone',
      missingKind: 'withheld_value_missing',
      withheldValue: '503-555-0199',
      source: 'test',
    },
    profile: { facts: {} },
    storageMap: {
      facts: {
        'contact.phone': {
          canonicalSlugs: ['contact.phone'],
          acceptedAliasSlugs: [],
        },
      },
    },
    activePreferences: [pref('unrelated.note', '503-555-0199')],
    usedPreferenceIndexes: new Set(),
  });

  assert.equal(row.classification, 'missing_value_hallucinated');
});

async function writeStoredPreferences(preferences) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-db-'));
  const artifactPath = path.join(tmp, 'stored-preferences.json');
  await writeFile(
    artifactPath,
    jsonText({
      schemaVersion: 1,
      artifactType: 'stored-preferences',
      userId: 'alex-i9-test',
      corpusId: 'realistic',
      storageInput: {
        ingestionMode: 'test',
        statusesScored: ['ACTIVE'],
        suggestionsWereAutoApplied: true,
      },
      preferences,
    }),
  );
  return artifactPath;
}

function pref(slug, value, status = 'ACTIVE') {
  return { slug, value, status, sourceType: 'INFERRED', confidence: 0.9 };
}

function row(report, factKey) {
  return report.knownPresent.find((candidate) => candidate.factKey === factKey);
}

function missingRow(report, factKey) {
  return report.intentionallyMissing.find((candidate) => candidate.factKey === factKey);
}
