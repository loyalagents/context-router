import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runScore } from './score.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');

test('score CLI prints help', async () => {
  const result = await runScore({ repoRoot, args: ['--help'] });
  assert.equal(result.exitCode, 0);
  assert.match(result.lines.join('\n'), /pnpm eval:score --mode database/);
});

test('score CLI reports invalid arguments clearly', async () => {
  const result = await runScore({ repoRoot, args: ['--mode', 'database'] });
  assert.equal(result.exitCode, 2);
  assert.match(result.lines.join('\n'), /Missing required --out/);
});

test('score CLI writes database, form, and combined reports', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-cli-'));
  const storedPreferencesPath = path.join(tmp, 'stored-preferences.json');
  const databaseReportPath = path.join(tmp, 'database-score-report.json');
  const formReportPath = path.join(tmp, 'form-fill-score-report.json');
  const combinedReportPath = path.join(tmp, 'combined-score-report.json');

  await writeFile(
    storedPreferencesPath,
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
      preferences: [
        {
          slug: 'profile.full_name',
          value: 'Alex Jordan Rivera',
          status: 'ACTIVE',
        },
      ],
    }),
  );

  const database = await runScore({
    repoRoot,
    args: [
      '--mode',
      'database',
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--stored-preferences',
      storedPreferencesPath,
      '--out',
      databaseReportPath,
    ],
  });
  assert.equal(database.exitCode, 0);
  assert.equal(JSON.parse(await readFile(databaseReportPath, 'utf8')).scoreType, 'database-storage');

  const form = await runScore({
    repoRoot,
    args: [
      '--mode',
      'form',
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--filled-form',
      'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      '--out',
      formReportPath,
    ],
  });
  assert.equal(form.exitCode, 0);
  assert.equal(JSON.parse(await readFile(formReportPath, 'utf8')).scoreType, 'form-fill');

  await writeFile(
    formReportPath,
    jsonText({
      schemaVersion: 1,
      scoreType: 'form-fill',
      scenarioId: 'alex-i9-realistic',
      userId: 'alex-i9-test',
      corpusId: 'realistic',
      formId: 'i-9',
      summary: formScoreSummary(),
      fields: [
        {
          fieldIndex: 0,
          pdfFieldName: 'name',
          factKey: 'identity.legalName',
          fieldClass: 'should-fill',
          expectedAction: 'SET_TEXT',
          expectedValue: 'Alex Jordan Rivera',
          actualValue: 'Alex Jordan Rivera',
          sourceSlugs: ['profile.full_name'],
          sourceSlugAgrees: true,
          snapshotClassification: 'correct',
          classification: 'form_known_correct',
        },
      ],
    }),
  );

  const combined = await runScore({
    repoRoot,
    args: [
      '--mode',
      'combined',
      '--database-report',
      databaseReportPath,
      '--form-report',
      formReportPath,
      '--out',
      combinedReportPath,
    ],
  });
  assert.equal(combined.exitCode, 0);
  assert.equal(JSON.parse(await readFile(combinedReportPath, 'utf8')).scoreType, 'combined');
});

test('score CLI writes unscorable database reports and exits nonzero', async () => {
  const tempRepoRoot = await mkdtemp(path.join(os.tmpdir(), 'score-cli-unscorable-'));
  await writeMinimalUnscorableRepo(tempRepoRoot);
  const storedPreferencesPath = path.join(tempRepoRoot, 'stored-preferences.json');
  const reportPath = path.join(tempRepoRoot, 'database-score-report.json');

  await writeFile(
    storedPreferencesPath,
    jsonText({
      schemaVersion: 1,
      artifactType: 'stored-preferences',
      userId: 'unscorable-user',
      corpusId: 'realistic',
      storageInput: { statusesScored: ['ACTIVE'] },
      preferences: [
        {
          slug: 'profile.full_name',
          value: 'Unscorable User',
          status: 'ACTIVE',
        },
      ],
    }),
  );

  const result = await runScore({
    repoRoot: tempRepoRoot,
    args: [
      '--mode',
      'database',
      '--user',
      'unscorable-user',
      '--corpus',
      'realistic',
      '--stored-preferences',
      storedPreferencesPath,
      '--out',
      reportPath,
    ],
  });

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.fixtureReadiness.scorable, false);
  assert.match(result.lines.join('\n'), /unscorable/);
});

test('score CLI database mode can use an explicit validation report', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-cli-validation-report-'));
  const storedPreferencesPath = path.join(tmp, 'stored-preferences.json');
  const validationReportPath = path.join(tmp, 'validation-report.json');
  const reportPath = path.join(tmp, 'database-score-report.json');

  await writeFile(
    storedPreferencesPath,
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
      preferences: [],
    }),
  );
  await writeFile(
    validationReportPath,
    jsonText({
      schemaVersion: 1,
      status: 'fail',
      summary: { errors: 1, warnings: 0 },
      corpusTruth: {
        summary: {
          hardFailures: 1,
          unsupportedDeclaredFacts: 0,
          factsMissing: 0,
          unsupportedDeclaredFactKeys: [],
        },
        documents: [],
      },
      issues: [],
    }),
  );

  const result = await runScore({
    repoRoot,
    args: [
      '--mode',
      'database',
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--stored-preferences',
      storedPreferencesPath,
      '--validation-report',
      validationReportPath,
      '--out',
      reportPath,
    ],
  });

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.fixtureReadiness.scorable, false);
  assert.match(report.fixtureReadiness.blockingIssues[0].reason, /status is fail/);
});

async function writeMinimalUnscorableRepo(tempRepoRoot) {
  const sourceSchemas = path.join(repoRoot, 'examples/eval/schemas');
  const targetSchemas = path.join(tempRepoRoot, 'examples/eval/schemas');
  const targetScoring = path.join(tempRepoRoot, 'examples/eval/scoring');
  const corpusRoot = path.join(
    tempRepoRoot,
    'examples/eval/users/unscorable-user/corpora/realistic',
  );
  await mkdir(targetSchemas, { recursive: true });
  await mkdir(targetScoring, { recursive: true });
  await mkdir(corpusRoot, { recursive: true });
  await mkdir(path.dirname(path.join(corpusRoot, '../../profile.yaml')), {
    recursive: true,
  });

  for (const schemaFile of [
    'stored-preferences.schema.json',
    'database-score-report.schema.json',
  ]) {
    await writeFile(
      path.join(targetSchemas, schemaFile),
      await readFile(path.join(sourceSchemas, schemaFile), 'utf8'),
    );
  }
  await writeFile(
    path.join(targetScoring, 'fact-storage-map.v1.json'),
    await readFile(
      path.join(repoRoot, 'examples/eval/scoring/fact-storage-map.v1.json'),
      'utf8',
    ),
  );
  await writeFile(
    path.join(tempRepoRoot, 'examples/eval/users/unscorable-user/profile.yaml'),
    [
      'schemaVersion: 1',
      'userId: unscorable-user',
      'displayName: Unscorable User',
      'facts:',
      '  identity:',
      '    legalName: Unscorable User',
      'seedPreferences: []',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(corpusRoot, 'manifest.json'),
    jsonText({
      schemaVersion: 2,
      userId: 'unscorable-user',
      corpusId: 'realistic',
      seed: 'unscorable',
      corpusKind: 'template-smoke',
      forms: ['i-9'],
      purpose: 'unscorable fixture',
      intentionallyMissing: [],
      documents: [],
    }),
  );
  await writeFile(
    path.join(corpusRoot, 'validation-report.json'),
    jsonText({
      schemaVersion: 1,
      status: 'fail',
      summary: { errors: 1, warnings: 0 },
      corpusTruth: {
        summary: {
          hardFailures: 1,
          unsupportedDeclaredFacts: 0,
          factsMissing: 0,
          unsupportedDeclaredFactKeys: [],
        },
        documents: [],
      },
      issues: [],
    }),
  );
}

function formScoreSummary() {
  return {
    knownFieldTotal: 1,
    knownFieldCorrect: 1,
    knownFieldMissing: 0,
    knownFieldWrong: 0,
    knownFieldAccuracy: 1,
    knownFieldMissingRate: 0,
    knownFieldWrongRate: 0,
    abstentionFieldTotal: 0,
    abstentionFieldAbsentCorrect: 0,
    abstentionFieldHallucinated: 0,
    missingFieldAbstentionRate: null,
    missingFieldHallucinationRate: null,
    structuralSkipCount: 0,
    unsupportedFieldCount: 0,
    sourceSlugAgreementRate: 1,
  };
}
