import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  runCompareRuns,
} from './compare-runs.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');

test('compare-runs CLI prints help and validates required args', async () => {
  const help = await runCompareRuns({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:compare-runs/);

  const missingBaseline = parseArgs(['--run', '/tmp/run']);
  assert.equal(missingBaseline.kind, 'usage-error');
  assert.equal(missingBaseline.message, 'Missing required --baseline');

  const missingRun = parseArgs(['--baseline', '/tmp/base']);
  assert.equal(missingRun.kind, 'usage-error');
  assert.equal(missingRun.message, 'Missing at least one --run');

  const parsed = parseArgs([
    '--baseline',
    '/tmp/base',
    '--run',
    '/tmp/run-a',
    '--run',
    '/tmp/run-b',
  ]);
  assert.equal(parsed.kind, 'ok');
  assert.deepEqual(parsed.options.runDirs, ['/tmp/run-a', '/tmp/run-b']);
});

test('compare-runs prints score deltas, changed issues, and optional context', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-runs-'));
  const baseline = path.join(tmp, 'baseline');
  const runA = path.join(tmp, 'run-a');
  const runB = path.join(tmp, 'run-b');

  await writeRunArtifacts({
    dir: baseline,
    runId: 'baseline-run',
    model: undefined,
    databaseSummary: {
      knownPresentTotal: 2,
      knownPresentCorrect: 1,
      knownPresentWrongSlug: 0,
      knownPresentWrongValue: 0,
      knownPresentConflict: 0,
      knownPresentMissing: 1,
      valueRecoveryRate: 0.5,
      acceptedSlugAccuracy: 0.5,
      acceptedSlugRecoveryRate: 0.5,
      intentionallyMissingTotal: 0,
      missingAbsentCorrect: 0,
      missingHallucinated: 0,
      missingAbstentionRate: null,
      ignoredStoredPreferenceCount: 0,
      unscoredStoredPreferenceCount: 0,
    },
    knownPresent: [
      knownRow('identity.legalName', 'known_present_missing'),
      knownRow('address.current.city', 'known_present_correct'),
    ],
    formSummary: formSummary({
      knownFieldTotal: 2,
      knownFieldCorrect: 1,
      knownFieldMissing: 1,
      knownFieldWrong: 0,
      structuralOverfillCount: 1,
    }),
    formFields: [
      formField('identity.legalName', 'Full Name', 'form_known_missing'),
      formField('address.current.city', 'City', 'form_known_correct'),
      structuralOverfillField('CB_1'),
    ],
    combinedCounts: { stored_missing_form_missing: 1 },
    ingestionSummary: {
      overwriteCount: 0,
      blankSuggestionSkippedCount: 0,
      forbiddenSuggestionBlockedCount: 0,
      staleOrNoiseOverwriteBlockedCount: 0,
    },
    storedPreferenceCount: 1,
  });

  await writeRunArtifacts({
    dir: runA,
    runId: 'run-a',
    model: { label: 'gemini-2.5-pro', source: 'manual' },
    databaseSummary: {
      knownPresentTotal: 2,
      knownPresentCorrect: 1,
      knownPresentWrongSlug: 0,
      knownPresentWrongValue: 1,
      knownPresentConflict: 0,
      knownPresentMissing: 0,
      valueRecoveryRate: 0.5,
      acceptedSlugAccuracy: 0.5,
      acceptedSlugRecoveryRate: 0.5,
      intentionallyMissingTotal: 0,
      missingAbsentCorrect: 0,
      missingHallucinated: 0,
      missingAbstentionRate: null,
      ignoredStoredPreferenceCount: 0,
      unscoredStoredPreferenceCount: 0,
    },
    knownPresent: [
      knownRow('identity.legalName', 'known_present_correct'),
      knownRow('address.current.city', 'known_present_wrong_value'),
    ],
    formSummary: formSummary({
      knownFieldTotal: 2,
      knownFieldCorrect: 1,
      knownFieldMissing: 0,
      knownFieldWrong: 1,
      structuralOverfillCount: 1,
    }),
    formFields: [
      formField('identity.legalName', 'Full Name', 'form_known_correct'),
      formField('address.current.city', 'City', 'form_known_wrong'),
      structuralOverfillField('CB_2'),
    ],
    combinedCounts: {
      stored_correct_form_correct: 1,
      stored_wrong_value_form_wrong: 1,
    },
    ingestionSummary: {
      overwriteCount: 1,
      blankSuggestionSkippedCount: 2,
      forbiddenSuggestionBlockedCount: 3,
      staleOrNoiseOverwriteBlockedCount: 4,
    },
    storedPreferenceCount: 2,
  });

  await writeRunArtifacts({
    dir: runB,
    runId: 'run-b',
    model: { label: 'gemini-2.5-flash-lite', source: 'manual' },
    databaseSummary: {
      knownPresentTotal: 2,
      knownPresentCorrect: 2,
      knownPresentWrongSlug: 0,
      knownPresentWrongValue: 0,
      knownPresentConflict: 0,
      knownPresentMissing: 0,
      valueRecoveryRate: 1,
      acceptedSlugAccuracy: 1,
      acceptedSlugRecoveryRate: 1,
      intentionallyMissingTotal: 0,
      missingAbsentCorrect: 0,
      missingHallucinated: 0,
      missingAbstentionRate: null,
      ignoredStoredPreferenceCount: 0,
      unscoredStoredPreferenceCount: 0,
    },
    knownPresent: [
      knownRow('identity.legalName', 'known_present_correct'),
      knownRow('address.current.city', 'known_present_correct'),
    ],
    formSummary: formSummary({
      knownFieldTotal: 2,
      knownFieldCorrect: 2,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      structuralOverfillCount: 0,
    }),
    formFields: [
      formField('identity.legalName', 'Full Name', 'form_known_correct'),
      formField('address.current.city', 'City', 'form_known_correct'),
    ],
    combinedCounts: { stored_correct_form_correct: 2 },
  });

  const result = await runCompareRuns({
    repoRoot,
    args: ['--baseline', baseline, '--run', runA, '--run', runB],
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const output = result.lines.join('\n');
  assert.match(output, /baseline baseline-run model=<unspecified> \(unspecified\)/);
  assert.match(output, /run run-a model=gemini-2\.5-pro \(manual\)/);
  assert.match(output, /run run-b model=gemini-2\.5-flash-lite \(manual\)/);
  assert.match(output, /database knownPresentMissing -1 \(1 -> 0\)/);
  assert.match(output, /database knownPresentWrongValue \+1 \(0 -> 1\)/);
  assert.match(output, /form knownFieldWrong \+1 \(0 -> 1\)/);
  assert.match(output, /database issues resolved: identity\.legalName/);
  assert.match(output, /database issues new: address\.current\.city/);
  assert.match(output, /form issues resolved: identity\.legalName @ Full Name/);
  assert.match(output, /form issues new: address\.current\.city @ City/);
  assert.match(output, /structural overfills removed: CB_1/);
  assert.match(output, /structural overfills added: CB_2/);
  assert.match(output, /combined stored_wrong_value_form_wrong \+1 \(0 -> 1\)/);
  assert.match(output, /ingestion overwriteCount \+1 \(0 -> 1\)/);
  assert.match(output, /stored preferences active \+1 \(1 -> 2\)/);
});

test('compare-runs fails clearly on identity mismatch', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'compare-runs-mismatch-'));
  const baseline = path.join(tmp, 'baseline');
  const run = path.join(tmp, 'run');

  await writeRunArtifacts({ dir: baseline, runId: 'baseline-run' });
  await writeRunArtifacts({ dir: run, runId: 'other-run', scenarioId: 'other-scenario' });

  const result = await runCompareRuns({
    repoRoot,
    args: ['--baseline', baseline, '--run', run],
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /identity mismatch/);
  assert.match(result.lines.join('\n'), /scenarioId/);
});

async function writeRunArtifacts({
  dir,
  runId,
  model,
  userId = 'alex-i9-test',
  corpusId = 'realistic',
  scenarioId = 'alex-i9-realistic',
  formId = 'i-9',
  databaseSummary = defaultDatabaseSummary(),
  knownPresent = [knownRow('identity.legalName', 'known_present_correct')],
  formSummary: formSummaryValue = formSummary({
    knownFieldTotal: 1,
    knownFieldCorrect: 1,
    knownFieldMissing: 0,
    knownFieldWrong: 0,
    structuralOverfillCount: 0,
  }),
  formFields = [formField('identity.legalName', 'Full Name', 'form_known_correct')],
  combinedCounts = { stored_correct_form_correct: 1 },
  ingestionSummary,
  storedPreferenceCount,
} = {}) {
  await mkdir(dir, { recursive: true });
  const evaluationRun = {
    schemaVersion: 1,
    artifactType: 'evaluation-run',
    evaluationMode: 'known-schema',
    status: 'pass',
    runId,
    userId,
    corpusId,
    scenarioId,
    documentsRoot: 'examples/eval/users/alex-i9-test/corpora/realistic',
    artifactsRoot: dir,
    backendUrl: 'http://localhost:3000/',
    graphqlUrl: 'http://localhost:3000/graphql',
    locationId: null,
    settings: {
      resetMemory: true,
      ensureDefinitions: true,
      autoApply: true,
      seedPreferences: false,
    },
    backendUserId: 'backend-user',
    failureStage: null,
    stages: [],
    summaries: {},
    startedAt: '2026-06-01T12:00:00.000Z',
    endedAt: '2026-06-01T12:01:00.000Z',
  };
  if (model !== undefined) evaluationRun.model = model;

  await writeJson(path.join(dir, 'evaluation-run.json'), evaluationRun);
  await writeJson(path.join(dir, 'database-score-report.json'), {
    schemaVersion: 1,
    scoreType: 'database-storage',
    userId,
    corpusId,
    storageInput: { statusesScored: ['ACTIVE'] },
    fixtureReadiness: { scorable: true, blockingIssues: [] },
    summary: databaseSummary,
    knownPresent,
    intentionallyMissing: [],
    ignoredStoredPreferences: [],
    unscoredStoredPreferences: [],
  });
  await writeJson(path.join(dir, 'form-score-report.json'), {
    schemaVersion: 1,
    scoreType: 'form-fill',
    scenarioId,
    userId,
    corpusId,
    formId,
    summary: formSummaryValue,
    fields: formFields,
  });
  await writeJson(path.join(dir, 'combined-score-report.json'), {
    schemaVersion: 1,
    scoreType: 'combined',
    userId,
    corpusId,
    scenarioId,
    formId,
    summary: {
      factTotal: Object.values(combinedCounts).reduce((sum, count) => sum + count, 0),
      stageAttributionCounts: combinedCounts,
    },
    facts: [],
  });
  if (ingestionSummary) {
    await writeJson(path.join(dir, 'ingestion-run.json'), {
      schemaVersion: 2,
      artifactType: 'ingestion-run',
      status: 'pass',
      evalUserId: userId,
      corpusId,
      backendUrl: 'http://localhost:3000/',
      graphqlUrl: 'http://localhost:3000/graphql',
      settings: {
        resetMemory: true,
        ensureDefinitions: true,
        autoApply: true,
        seedPreferences: false,
      },
      documents: [],
      summary: {
        documentCount: 0,
        uploadedCount: 0,
        analyzedCount: 0,
        failedDocumentCount: 0,
        suggestionCount: 0,
        filteredSuggestionCount: 0,
        appliedSuggestionCount: 0,
        applyFailureCount: 0,
        createdDefinitionCount: 0,
        seedPreferenceCount: 0,
        ...ingestionSummary,
      },
      startedAt: '2026-06-01T12:00:00.000Z',
      endedAt: '2026-06-01T12:01:00.000Z',
    });
  }
  if (storedPreferenceCount !== undefined) {
    await writeJson(path.join(dir, 'stored-preferences.json'), {
      schemaVersion: 1,
      artifactType: 'stored-preferences',
      userId,
      corpusId,
      storageInput: { statusesScored: ['ACTIVE'] },
      preferences: Array.from({ length: storedPreferenceCount }, (_value, index) => ({
        slug: `profile.fact_${index}`,
        value: `value-${index}`,
        status: 'ACTIVE',
      })),
    });
  }
}

function defaultDatabaseSummary() {
  return {
    knownPresentTotal: 1,
    knownPresentCorrect: 1,
    knownPresentWrongSlug: 0,
    knownPresentWrongValue: 0,
    knownPresentConflict: 0,
    knownPresentMissing: 0,
    valueRecoveryRate: 1,
    acceptedSlugAccuracy: 1,
    acceptedSlugRecoveryRate: 1,
    intentionallyMissingTotal: 0,
    missingAbsentCorrect: 0,
    missingHallucinated: 0,
    missingAbstentionRate: null,
    ignoredStoredPreferenceCount: 0,
    unscoredStoredPreferenceCount: 0,
  };
}

function knownRow(factKey, classification) {
  const slug = `profile.${factKey.replaceAll('.', '_')}`;
  const isCorrect = classification === 'known_present_correct';
  const isMissing = classification === 'known_present_missing';
  return {
    factKey,
    expectedValue: 'expected',
    canonicalSlugs: [slug],
    acceptedAliasSlugs: [],
    expectedValueFoundAnywhere: isCorrect,
    expectedValueFoundUnderAcceptedSlug: isCorrect,
    acceptedSlugPopulated: !isMissing,
    acceptedSlugHasWrongValue: classification === 'known_present_wrong_value',
    canonicalSlugCorrect: isCorrect,
    acceptedAliasCorrect: false,
    matchingRows: isCorrect
      ? [{ slug, value: 'expected', status: 'ACTIVE', sourceType: null, confidence: null }]
      : [],
    acceptedSlugRows: isMissing
      ? []
      : [{ slug, value: isCorrect ? 'expected' : 'wrong', status: 'ACTIVE', sourceType: null, confidence: null }],
    classification,
  };
}

function formSummary({
  knownFieldTotal,
  knownFieldCorrect,
  knownFieldMissing,
  knownFieldWrong,
  structuralOverfillCount,
}) {
  return {
    knownFieldTotal,
    knownFieldCorrect,
    knownFieldMissing,
    knownFieldWrong,
    knownFieldAccuracy: knownFieldTotal ? knownFieldCorrect / knownFieldTotal : null,
    knownFieldMissingRate: knownFieldTotal ? knownFieldMissing / knownFieldTotal : null,
    knownFieldWrongRate: knownFieldTotal ? knownFieldWrong / knownFieldTotal : null,
    abstentionFieldTotal: 0,
    abstentionFieldAbsentCorrect: 0,
    abstentionFieldHallucinated: 0,
    missingFieldAbstentionRate: null,
    missingFieldHallucinationRate: null,
    structuralSkipCount: structuralOverfillCount,
    structuralOverfillCount,
    manualAttestationOverfillCount: 0,
    outOfScopeOverfillCount: 0,
    unmappedOverfillCount: structuralOverfillCount,
    unsupportedFieldCount: 0,
    sourceSlugAgreementRate: knownFieldCorrect ? 1 : null,
  };
}

function formField(factKey, pdfFieldName, classification) {
  const snapshotClassification = {
    form_known_correct: 'correct',
    form_known_missing: 'missing',
    form_known_wrong: 'incorrect',
  }[classification];
  return {
    fieldIndex: 0,
    pdfFieldName,
    factKey,
    fieldClass: 'should-fill',
    expectedAction: 'SET_TEXT',
    expectedValue: 'expected',
    actualValue: classification === 'form_known_missing' ? null : 'actual',
    sourceSlugs: [],
    sourceSlugAgrees: false,
    snapshotClassification,
    classification,
    overfill: false,
    overfillSeverity: null,
    overfillReason: null,
  };
}

function structuralOverfillField(pdfFieldName) {
  return {
    fieldIndex: 99,
    pdfFieldName,
    factKey: null,
    fieldClass: 'structural-skip',
    expectedAction: 'SKIP',
    expectedValue: null,
    actualValue: 'unexpected',
    sourceSlugs: [],
    sourceSlugAgrees: false,
    snapshotClassification: 'hallucinated',
    classification: 'structural_overfilled',
    overfill: true,
    overfillSeverity: 'medium',
    overfillReason: 'unmapped',
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, jsonText(value));
}
