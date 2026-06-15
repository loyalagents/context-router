#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJson,
  relativePath,
  validateWithSchema,
} from './scoring/io.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

const DATABASE_METRICS = [
  'knownPresentTotal',
  'knownPresentCorrect',
  'knownPresentWrongSlug',
  'knownPresentWrongValue',
  'knownPresentConflict',
  'knownPresentMissing',
  'intentionallyMissingTotal',
  'missingAbsentCorrect',
  'missingHallucinated',
  'ignoredStoredPreferenceCount',
  'unscoredStoredPreferenceCount',
];

const FORM_METRICS = [
  'knownFieldTotal',
  'knownFieldCorrect',
  'knownFieldMissing',
  'knownFieldWrong',
  'abstentionFieldTotal',
  'abstentionFieldAbsentCorrect',
  'abstentionFieldHallucinated',
  'structuralSkipCount',
  'structuralOverfillCount',
  'manualAttestationOverfillCount',
  'outOfScopeOverfillCount',
  'unmappedOverfillCount',
  'unsupportedFieldCount',
];

const INGESTION_METRICS = [
  'overwriteCount',
  'blankSuggestionSkippedCount',
  'forbiddenSuggestionBlockedCount',
  'staleOrNoiseOverwriteBlockedCount',
];

const DATABASE_ISSUE_CLASSES = new Set([
  'known_present_wrong_slug',
  'known_present_wrong_value',
  'known_present_conflict',
  'known_present_missing',
  'missing_value_hallucinated',
  'missing_key_hallucinated',
  'missing_hallucinated',
]);

const FORM_ISSUE_CLASSES = new Set([
  'form_known_missing',
  'form_known_wrong',
  'form_missing_hallucinated',
  'form_unexpected',
]);

export async function runCompareRuns({
  repoRoot = defaultRepoRoot,
  args = [],
} = {}) {
  const parsed = parseArgs(args);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  try {
    const baseline = await loadRunDirectory({
      repoRoot,
      dir: parsed.options.baselineDir,
      label: 'baseline',
    });
    const runs = [];
    for (const [index, dir] of parsed.options.runDirs.entries()) {
      runs.push(
        await loadRunDirectory({
          repoRoot,
          dir,
          label: `run ${index + 1}`,
        }),
      );
    }

    const lines = [
      'eval compare-runs passed',
      `baseline ${baseline.runId} model=${formatModel(baseline.model)} status=${baseline.status} artifacts=${relativePath(repoRoot, baseline.dir)}`,
    ];

    for (const run of runs) {
      assertComparable({ baseline, run });
      lines.push(
        '',
        `run ${run.runId} model=${formatModel(run.model)} status=${run.status} artifacts=${relativePath(repoRoot, run.dir)}`,
        ...comparisonLines({ baseline, run }),
      );
    }

    return { exitCode: 0, lines, baseline, runs };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [
        'eval compare-runs failed',
        '',
        error?.stack ?? error?.message ?? String(error),
      ],
      error,
    };
  }
}

export function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = { runDirs: [] };
  const valueArgs = new Set(['--baseline', '--run']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!valueArgs.has(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;
    if (arg === '--baseline') options.baselineDir = value;
    if (arg === '--run') options.runDirs.push(value);
  }

  if (!options.baselineDir) {
    return { kind: 'usage-error', message: 'Missing required --baseline' };
  }
  if (options.runDirs.length === 0) {
    return { kind: 'usage-error', message: 'Missing at least one --run' };
  }
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:compare-runs --baseline <dir> --run <dir> [--run <dir>...]',
    '',
    'Notes:',
    '  Compares known-schema E2E artifact directories.',
    '  Required files: evaluation-run.json, database-score-report.json, form-score-report.json, combined-score-report.json.',
    '  Optional context: ingestion-run.json and stored-preferences.json.',
  ].join('\n');
}

export function formatCompareRunsResult(result) {
  return result.lines.join('\n');
}

async function loadRunDirectory({ repoRoot, dir, label }) {
  const resolvedDir = path.resolve(repoRoot, dir);
  const evaluationRun = await readRequiredJson(
    path.join(resolvedDir, 'evaluation-run.json'),
    label,
  );
  const databaseReport = await readRequiredJson(
    path.join(resolvedDir, 'database-score-report.json'),
    label,
  );
  const formReport = await readRequiredJson(
    path.join(resolvedDir, 'form-score-report.json'),
    label,
  );
  const combinedReport = await readRequiredJson(
    path.join(resolvedDir, 'combined-score-report.json'),
    label,
  );

  // Do not schema-validate evaluation-run.json here. Compare-runs intentionally
  // supports older local artifacts, including v1 runs that predate model
  // metadata, while score reports remain the required comparable contracts.
  await validateWithSchema(
    repoRoot,
    'database-score-report.schema.json',
    databaseReport,
    `${label} database score report`,
  );
  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    formReport,
    `${label} form score report`,
  );
  await validateWithSchema(
    repoRoot,
    'combined-score-report.schema.json',
    combinedReport,
    `${label} combined score report`,
  );

  const ingestionRun = await readOptionalJson(path.join(resolvedDir, 'ingestion-run.json'));
  const storedPreferences = await readOptionalJson(
    path.join(resolvedDir, 'stored-preferences.json'),
  );
  const identity = identityForRun({
    evaluationRun,
    databaseReport,
    formReport,
    combinedReport,
    label,
  });

  return {
    dir: resolvedDir,
    runId: evaluationRun.runId ?? '<unknown-run>',
    status: evaluationRun.status ?? '<unknown-status>',
    model: normalizedModel(evaluationRun.model),
    evaluationRun,
    databaseReport,
    formReport,
    combinedReport,
    ingestionRun,
    storedPreferences,
    identity,
  };
}

async function readRequiredJson(filePath, label) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} is missing required artifact ${filePath}`);
    }
    throw error;
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function identityForRun({
  evaluationRun,
  databaseReport,
  formReport,
  combinedReport,
  label,
}) {
  const identity = {
    userId: databaseReport.userId,
    corpusId: databaseReport.corpusId,
    scenarioId: formReport.scenarioId,
    formId: formReport.formId,
  };
  assertIdentityValue({
    label,
    key: 'userId',
    expected: identity.userId,
    candidates: [
      ['evaluation-run.json', evaluationRun.userId],
      ['form-score-report.json', formReport.userId],
      ['combined-score-report.json', combinedReport.userId],
    ],
  });
  assertIdentityValue({
    label,
    key: 'corpusId',
    expected: identity.corpusId,
    candidates: [
      ['evaluation-run.json', evaluationRun.corpusId],
      ['form-score-report.json', formReport.corpusId],
      ['combined-score-report.json', combinedReport.corpusId],
    ],
  });
  assertIdentityValue({
    label,
    key: 'scenarioId',
    expected: identity.scenarioId,
    candidates: [
      ['evaluation-run.json', evaluationRun.scenarioId],
      ['combined-score-report.json', combinedReport.scenarioId],
    ],
  });
  assertIdentityValue({
    label,
    key: 'formId',
    expected: identity.formId,
    candidates: [['combined-score-report.json', combinedReport.formId]],
  });
  return identity;
}

function assertIdentityValue({ label, key, expected, candidates }) {
  for (const [source, actual] of candidates) {
    if (actual !== expected) {
      throw new Error(
        `${label} report identity mismatch: ${key} ${source} has ${actual}, expected ${expected}`,
      );
    }
  }
}

function assertComparable({ baseline, run }) {
  for (const key of ['userId', 'corpusId', 'scenarioId', 'formId']) {
    if (baseline.identity[key] !== run.identity[key]) {
      throw new Error(
        `identity mismatch for run ${run.runId}: ${key} baseline ${baseline.identity[key]} vs run ${run.identity[key]}`,
      );
    }
  }
}

function comparisonLines({ baseline, run }) {
  return [
    ...metricDeltaLines('database', DATABASE_METRICS, baseline.databaseReport.summary, run.databaseReport.summary),
    ...metricDeltaLines('form', FORM_METRICS, baseline.formReport.summary, run.formReport.summary),
    ...issueComparisonLines({
      label: 'database issues',
      baselineIssues: databaseIssues(baseline.databaseReport),
      runIssues: databaseIssues(run.databaseReport),
    }),
    ...issueComparisonLines({
      label: 'form issues',
      baselineIssues: formIssues(baseline.formReport),
      runIssues: formIssues(run.formReport),
    }),
    ...issueComparisonLines({
      label: 'structural overfills',
      baselineIssues: structuralOverfills(baseline.formReport),
      runIssues: structuralOverfills(run.formReport),
      valueLabel: false,
      resolvedLabel: 'removed',
      addedLabel: 'added',
    }),
    ...combinedDeltaLines(baseline.combinedReport, run.combinedReport),
    ...optionalIngestionLines(baseline.ingestionRun, run.ingestionRun),
    ...optionalStoredPreferenceLines(baseline.storedPreferences, run.storedPreferences),
  ];
}

function metricDeltaLines(prefix, metrics, baselineSummary, runSummary) {
  const lines = [];
  for (const metric of metrics) {
    const before = numberOrZero(baselineSummary?.[metric]);
    const after = numberOrZero(runSummary?.[metric]);
    if (before !== after) {
      lines.push(formatDelta(prefix, metric, before, after));
    }
  }
  return lines.length > 0 ? lines : [`${prefix} no score deltas`];
}

function databaseIssues(report) {
  const issues = new Map();
  for (const row of [...(report.knownPresent ?? []), ...(report.intentionallyMissing ?? [])]) {
    if (DATABASE_ISSUE_CLASSES.has(row.classification)) {
      issues.set(row.factKey, row.classification);
    }
  }
  return issues;
}

function formIssues(report) {
  const issues = new Map();
  for (const row of report.fields ?? []) {
    if (FORM_ISSUE_CLASSES.has(row.classification)) {
      issues.set(formIssueKey(row), row.classification);
    }
  }
  return issues;
}

function structuralOverfills(report) {
  const issues = new Map();
  for (const row of report.fields ?? []) {
    if (row.overfill || row.classification === 'structural_overfilled') {
      issues.set(row.pdfFieldName, row.overfillReason ?? row.classification);
    }
  }
  return issues;
}

function issueComparisonLines({
  label,
  baselineIssues,
  runIssues,
  valueLabel = true,
  resolvedLabel = 'resolved',
  addedLabel = 'new',
}) {
  const resolved = [];
  const added = [];
  const changed = [];
  for (const [key, value] of baselineIssues.entries()) {
    if (!runIssues.has(key)) {
      resolved.push(key);
      continue;
    }
    const nextValue = runIssues.get(key);
    if (nextValue !== value) {
      changed.push(valueLabel ? `${key} (${value} -> ${nextValue})` : key);
    }
  }
  for (const [key] of runIssues.entries()) {
    if (!baselineIssues.has(key)) added.push(key);
  }

  const lines = [];
  if (resolved.length > 0) lines.push(`${label} ${resolvedLabel}: ${resolved.sort().join(', ')}`);
  if (added.length > 0) lines.push(`${label} ${addedLabel}: ${added.sort().join(', ')}`);
  if (changed.length > 0) lines.push(`${label} changed: ${changed.sort().join(', ')}`);
  if (lines.length === 0) lines.push(`${label} unchanged`);
  return lines;
}

function combinedDeltaLines(baselineReport, runReport) {
  const baselineCounts = baselineReport.summary?.stageAttributionCounts ?? {};
  const runCounts = runReport.summary?.stageAttributionCounts ?? {};
  const keys = [...new Set([...Object.keys(baselineCounts), ...Object.keys(runCounts)])].sort();
  const lines = [];
  for (const key of keys) {
    const before = numberOrZero(baselineCounts[key]);
    const after = numberOrZero(runCounts[key]);
    if (before !== after) {
      lines.push(formatDelta('combined', key, before, after));
    }
  }
  return lines.length > 0 ? lines : ['combined no attribution deltas'];
}

function optionalIngestionLines(baselineIngestion, runIngestion) {
  if (!baselineIngestion || !runIngestion) return [];
  const lines = [];
  for (const metric of INGESTION_METRICS) {
    const before = numberOrZero(baselineIngestion.summary?.[metric]);
    const after = numberOrZero(runIngestion.summary?.[metric]);
    if (before !== after) {
      lines.push(formatDelta('ingestion', metric, before, after));
    }
  }
  return lines;
}

function optionalStoredPreferenceLines(baselineStored, runStored) {
  if (!baselineStored || !runStored) return [];
  const lines = [];
  for (const [metric, before, after] of [
    ['active', baselineStored.preferences?.length ?? 0, runStored.preferences?.length ?? 0],
    ['suggested', baselineStored.suggestions?.length ?? 0, runStored.suggestions?.length ?? 0],
  ]) {
    if (before !== after) {
      lines.push(formatDelta('stored preferences', metric, before, after));
    }
  }
  return lines;
}

function formIssueKey(row) {
  return `${row.factKey ?? '<no fact>'} @ ${row.pdfFieldName}`;
}

function normalizedModel(model) {
  if (model && typeof model === 'object') {
    return {
      label: typeof model.label === 'string' && model.label ? model.label : null,
      source: typeof model.source === 'string' && model.source ? model.source : 'unspecified',
    };
  }
  return { label: null, source: 'unspecified' };
}

function formatModel(model) {
  return `${model.label ?? '<unspecified>'} (${model.source})`;
}

function formatDelta(prefix, metric, before, after) {
  const delta = after - before;
  return `${prefix} ${metric} ${formatSigned(delta)} (${before} -> ${after})`;
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCompareRuns({ args: process.argv.slice(2) });
  console.log(formatCompareRunsResult(result));
  process.exitCode = result.exitCode;
}
