#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExportStoredPreferences } from './export-stored-preferences.mjs';
import { runFillForm } from './fill-form.mjs';
import { runIngestDocuments } from './ingest-documents.mjs';
import { readJson, relativePath, validateWithSchema, writeJson } from './scoring/io.mjs';
import { runScore } from './score.mjs';
import { isFixtureId } from './shared.mjs';
import {
  formatResult as formatValidationResult,
  runValidation,
} from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_GRAPHQL_URL = 'http://localhost:3000/graphql';
const INGESTION_MODE = 'known-schema-e2e';

const STAGE_NAMES = [
  'validate-documents',
  'ingest-documents',
  'export-stored-preferences',
  'score-database',
  'fill-form',
  'score-form',
  'score-combined',
];

export async function runKnownSchemaE2E({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  pdfFieldReader,
  now = () => new Date(),
  runners = {},
} = {}) {
  const parsed = parseArgs(args, env, now);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  const stageRunners = {
    validate: runValidation,
    ingest: runIngestDocuments,
    exportStoredPreferences: runExportStoredPreferences,
    score: runScore,
    fillForm: runFillForm,
    ...runners,
  };
  const artifacts = buildArtifacts({ repoRoot, options });
  const report = initialReport({ repoRoot, options, artifacts, startedAt: isoTimestamp(now) });
  const reportPath = artifacts.evaluationRun;

  const writeReport = async () => {
    await validateWithSchema(
      repoRoot,
      'evaluation-run.schema.json',
      report,
      'evaluation run',
    );
    await writeJson(reportPath, report);
  };

  try {
    await writeReport();

    const stages = [
      {
        name: 'validate-documents',
        runner: async () => {
          const result = await stageRunners.validate({
            repoRoot,
            args: [
              '--user',
              options.userId,
              '--corpus',
              options.corpusId,
              '--documents-root',
              options.documentsRoot,
              '--report-out',
              artifacts.validationReport,
            ],
          });
          return {
            ...result,
            lines: result.lines ?? [formatValidationResult(result)],
          };
        },
        afterSuccess: async () => {
          const validationReport = await readJson(artifacts.validationReport);
          report.summaries.validation = validationReport.summary ?? null;
        },
      },
      {
        name: 'ingest-documents',
        runner: () =>
          stageRunners.ingest({
            repoRoot,
            args: ingestArgs(options, artifacts),
            env: {},
            fetchImpl,
            now,
          }),
        afterSuccess: async () => {
          const ingestionRun = await readJson(artifacts.ingestionRun);
          report.backendUserId = ingestionRun.backendUserId ?? report.backendUserId;
          report.summaries.ingestion = ingestionRun.summary ?? null;
        },
      },
      {
        name: 'export-stored-preferences',
        runner: () =>
          stageRunners.exportStoredPreferences({
            repoRoot,
            args: exportArgs(options, artifacts),
            env: {},
            fetchImpl,
            now,
          }),
        afterSuccess: async () => {
          const storedPreferences = await readJson(artifacts.storedPreferences);
          report.backendUserId =
            storedPreferences.diagnostics?.backendUserId ?? report.backendUserId;
          report.summaries.export = {
            activePreferenceCount: storedPreferences.preferences?.length ?? 0,
            suggestedPreferenceCount: storedPreferences.suggestions?.length ?? 0,
          };
        },
      },
      {
        name: 'score-database',
        runner: () =>
          stageRunners.score({
            repoRoot,
            args: [
              '--mode',
              'database',
              '--user',
              options.userId,
              '--corpus',
              options.corpusId,
              '--stored-preferences',
              artifacts.storedPreferences,
              '--validation-report',
              artifacts.validationReport,
              '--out',
              artifacts.databaseScoreReport,
            ],
          }),
        afterSuccess: async () => {
          const databaseScore = await readJson(artifacts.databaseScoreReport);
          report.summaries.databaseScore = databaseScore.summary ?? null;
        },
      },
      {
        name: 'fill-form',
        runner: () =>
          stageRunners.fillForm({
            repoRoot,
            args: [
              '--scenario',
              options.scenarioId,
              '--out',
              artifacts.filledForm,
              '--backend-url',
              options.backendUrl,
              '--auth-token',
              options.authToken,
              '--filled-pdf-out',
              artifacts.filledPdf,
              '--response-out',
              artifacts.formFillResponse,
            ],
            env: {},
            fetchImpl,
            ...(pdfFieldReader ? { pdfFieldReader } : {}),
          }),
        afterSuccess: async () => {
          const filledForm = await readJson(artifacts.filledForm);
          report.summaries.formFill = {
            status: filledForm.response?.status ?? null,
            fieldCount: filledForm.fields?.length ?? 0,
          };
        },
      },
      {
        name: 'score-form',
        runner: () =>
          stageRunners.score({
            repoRoot,
            args: [
              '--mode',
              'form',
              '--scenario',
              options.scenarioId,
              '--filled-form',
              artifacts.filledForm,
              '--out',
              artifacts.formScoreReport,
            ],
          }),
        afterSuccess: async () => {
          const formScore = await readJson(artifacts.formScoreReport);
          report.summaries.formScore = formScore.summary ?? null;
        },
      },
      {
        name: 'score-combined',
        runner: () =>
          stageRunners.score({
            repoRoot,
            args: [
              '--mode',
              'combined',
              '--database-report',
              artifacts.databaseScoreReport,
              '--form-report',
              artifacts.formScoreReport,
              '--out',
              artifacts.combinedScoreReport,
            ],
          }),
        afterSuccess: async () => {
          const combinedScore = await readJson(artifacts.combinedScoreReport);
          report.summaries.combinedScore = combinedScore.summary ?? null;
        },
      },
    ];

    for (const stage of stages) {
      const result = await runStage({ stage, report, options, now });
      await writeReport();
      if (result.exitCode !== 0) {
        report.status = 'fail';
        report.failureStage = stage.name;
        report.endedAt = isoTimestamp(now);
        markRemainingStagesSkipped(report, stage.name);
        await writeReport();
        return {
          exitCode: result.exitCode,
          lines: failureLines({ report, reportPath, repoRoot, stageName: stage.name }),
          report,
        };
      }
    }

    report.status = 'pass';
    report.endedAt = isoTimestamp(now);
    await writeReport();

    return {
      exitCode: 0,
      lines: [
        'eval e2e-known-schema passed',
        `runId=${report.runId}`,
        `artifacts=${relativePath(repoRoot, artifacts.artifactsRoot)}`,
        `wrote ${relativePath(repoRoot, reportPath)}`,
      ],
      report,
    };
  } catch (error) {
    report.status = 'fail';
    report.endedAt = isoTimestamp(now);
    report.failureStage = report.failureStage ?? activeStageName(report);
    if (report.failureStage) {
      markRemainingStagesSkipped(report, report.failureStage);
    }
    try {
      await writeReport();
    } catch {
      // Keep the primary failure visible in CLI output.
    }
    const message = redactSecret(
      error?.stack ?? error?.message ?? String(error),
      options.authToken,
    );
    return {
      exitCode: 1,
      lines: [
        'eval e2e-known-schema failed',
        report.failureStage ? `stage=${report.failureStage}` : 'stage=<setup>',
        `wrote ${relativePath(repoRoot, reportPath)}`,
        '',
        message,
      ],
      report,
      error,
    };
  }
}

async function runStage({ stage, report, options, now }) {
  const stageRecord = report.stages.find((candidate) => candidate.name === stage.name);
  stageRecord.status = 'running';
  stageRecord.startedAt = isoTimestamp(now);
  let result;
  try {
    result = await stage.runner();
  } catch (error) {
    stageRecord.endedAt = isoTimestamp(now);
    stageRecord.durationMs = durationMs(stageRecord.startedAt, stageRecord.endedAt);
    stageRecord.exitCode = 1;
    stageRecord.status = 'failed';
    stageRecord.lines = redactLines(
      [
        `eval stage ${stage.name} failed`,
        '',
        error?.stack ?? error?.message ?? String(error),
      ],
      options.authToken,
    );
    stageRecord.error = stageRecord.lines.join('\n');
    return { exitCode: 1, lines: stageRecord.lines, error };
  }
  stageRecord.endedAt = isoTimestamp(now);
  stageRecord.durationMs = durationMs(stageRecord.startedAt, stageRecord.endedAt);
  stageRecord.exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
  stageRecord.lines = redactLines(result?.lines ?? [], options.authToken);

  if (stageRecord.exitCode === 0) {
    try {
      if (stage.afterSuccess) {
        await stage.afterSuccess();
      }
      stageRecord.status = 'passed';
    } catch (error) {
      stageRecord.exitCode = 1;
      stageRecord.status = 'failed';
      stageRecord.lines = redactLines(
        [
          ...stageRecord.lines,
          '',
          `eval stage ${stage.name} artifact handling failed`,
          error?.stack ?? error?.message ?? String(error),
        ],
        options.authToken,
      );
      stageRecord.error = stageRecord.lines.join('\n');
      return { exitCode: 1, lines: stageRecord.lines, error };
    }
  } else {
    stageRecord.status = 'failed';
    stageRecord.error = stageRecord.lines.join('\n') || `Stage ${stage.name} failed.`;
  }

  return {
    ...result,
    exitCode: stageRecord.exitCode,
  };
}

export function parseArgs(args, env = process.env, now = () => new Date()) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    backendUrl: env.EVAL_BACKEND_URL || DEFAULT_BACKEND_URL,
    graphqlUrl: env.EVAL_GRAPHQL_URL || DEFAULT_GRAPHQL_URL,
    authToken: env.EVAL_AUTH_TOKEN,
    modelLabel: env.EVAL_MODEL_LABEL,
    resetMemory: false,
    ensureDefinitions: true,
    autoApply: true,
  };
  const valueArgs = new Set([
    '--user',
    '--corpus',
    '--scenario',
    '--artifacts-root',
    '--documents-root',
    '--backend-url',
    '--graphql-url',
    '--auth-token',
    '--model-label',
    '--seed-preferences',
    '--location-id',
    '--run-id',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--reset-memory') {
      options.resetMemory = true;
      continue;
    }
    if (arg === '--skip-ensure-definitions') {
      options.ensureDefinitions = false;
      continue;
    }
    if (arg === '--no-auto-apply') {
      options.autoApply = false;
      continue;
    }
    if (!valueArgs.has(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--artifacts-root') options.artifactsRoot = value;
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--backend-url') options.backendUrl = value;
    if (arg === '--graphql-url') options.graphqlUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--model-label') options.modelLabel = value;
    if (arg === '--seed-preferences') options.seedPreferencesPath = value;
    if (arg === '--location-id') options.locationId = value;
    if (arg === '--run-id') options.runId = value;
  }

  for (const [key, flag] of [
    ['userId', '--user'],
    ['corpusId', '--corpus'],
    ['scenarioId', '--scenario'],
    ['artifactsRoot', '--artifacts-root'],
  ]) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${flag}` };
    }
  }
  for (const [label, value] of [
    ['--user', options.userId],
    ['--corpus', options.corpusId],
    ['--scenario', options.scenarioId],
  ]) {
    if (!isFixtureId(value)) {
      return { kind: 'usage-error', message: `${label} must be a fixture id.` };
    }
  }
  if (!options.authToken) {
    return {
      kind: 'usage-error',
      message: 'Missing required --auth-token or EVAL_AUTH_TOKEN',
    };
  }

  options.documentsRoot =
    options.documentsRoot ??
    ['examples', 'eval', 'users', options.userId, 'corpora', options.corpusId].join('/');
  options.runId = options.runId ?? generatedRunId(options, now);
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:e2e-known-schema --user <userId> --corpus <corpusId> --scenario <scenarioId> --artifacts-root <dir> [options]',
    '',
    'Notes:',
    '  This wrapper runs the known-schema live backend evaluation chain.',
    '  It uses existing document files; it does not generate corpora or discover new slugs.',
    '  Low scores are reported but do not fail the wrapper. Runtime/setup failures stop the run.',
    '  Prefer EVAL_AUTH_TOKEN over --auth-token to avoid shell history and process-list exposure.',
    '',
    'Options:',
    '  --documents-root <dir>            Defaults to examples/eval/users/<user>/corpora/<corpus>',
    '  --backend-url <url>               Defaults to EVAL_BACKEND_URL or http://localhost:3000',
    '  --graphql-url <url>               Defaults to EVAL_GRAPHQL_URL or http://localhost:3000/graphql',
    '  --auth-token <token>              Defaults to EVAL_AUTH_TOKEN',
    '  --model-label <label>             Defaults to EVAL_MODEL_LABEL; records manual model/config metadata',
    '  --reset-memory                    Clear current backend user memory before ingestion',
    '  --seed-preferences <file>          Set explicit seed preferences before upload',
    '  --skip-ensure-definitions          Do not create missing known-schema definitions',
    '  --no-auto-apply                    Upload and record suggestions without applying them',
    '  --location-id <locationId>         Export merged global + location view',
    '  --run-id <id>',
  ].join('\n');
}

export function formatKnownSchemaE2EResult(result) {
  return result.lines.join('\n');
}

function buildArtifacts({ repoRoot, options }) {
  const artifactsRoot = path.resolve(repoRoot, options.artifactsRoot);
  return {
    artifactsRoot,
    validationReport: path.join(artifactsRoot, 'validation-report.json'),
    ingestionRun: path.join(artifactsRoot, 'ingestion-run.json'),
    storedPreferences: path.join(artifactsRoot, 'stored-preferences.json'),
    databaseScoreReport: path.join(artifactsRoot, 'database-score-report.json'),
    filledForm: path.join(artifactsRoot, 'filled-form.json'),
    filledPdf: path.join(artifactsRoot, 'filled-form.pdf'),
    formFillResponse: path.join(artifactsRoot, 'form-fill-response.json'),
    formScoreReport: path.join(artifactsRoot, 'form-score-report.json'),
    combinedScoreReport: path.join(artifactsRoot, 'combined-score-report.json'),
    evaluationRun: path.join(artifactsRoot, 'evaluation-run.json'),
  };
}

function initialReport({ repoRoot, options, artifacts, startedAt }) {
  return {
    schemaVersion: 2,
    artifactType: 'evaluation-run',
    evaluationMode: 'known-schema',
    status: 'running',
    runId: options.runId,
    userId: options.userId,
    corpusId: options.corpusId,
    scenarioId: options.scenarioId,
    documentsRoot: relativePath(repoRoot, path.resolve(repoRoot, options.documentsRoot)),
    artifactsRoot: relativePath(repoRoot, artifacts.artifactsRoot),
    backendUrl: sanitizeUrlForArtifact(options.backendUrl),
    graphqlUrl: sanitizeUrlForArtifact(options.graphqlUrl),
    model: modelMetadata(options),
    locationId: options.locationId ?? null,
    settings: {
      resetMemory: options.resetMemory,
      ensureDefinitions: options.ensureDefinitions,
      autoApply: options.autoApply,
      seedPreferences: Boolean(options.seedPreferencesPath),
    },
    backendUserId: null,
    failureStage: null,
    stages: STAGE_NAMES.map((name) => ({
      name,
      status: 'pending',
      startedAt: null,
      endedAt: null,
      durationMs: null,
      exitCode: null,
      artifacts: artifactMapForStage({ repoRoot, artifacts, name }),
      lines: [],
      error: null,
    })),
    summaries: {
      validation: null,
      ingestion: null,
      export: null,
      databaseScore: null,
      formFill: null,
      formScore: null,
      combinedScore: null,
    },
    startedAt,
    endedAt: null,
  };
}

function artifactMapForStage({ repoRoot, artifacts, name }) {
  const map = {
    'validate-documents': { validationReport: artifacts.validationReport },
    'ingest-documents': { ingestionRun: artifacts.ingestionRun },
    'export-stored-preferences': { storedPreferences: artifacts.storedPreferences },
    'score-database': { databaseScoreReport: artifacts.databaseScoreReport },
    'fill-form': {
      filledForm: artifacts.filledForm,
      filledPdf: artifacts.filledPdf,
      response: artifacts.formFillResponse,
    },
    'score-form': { formScoreReport: artifacts.formScoreReport },
    'score-combined': { combinedScoreReport: artifacts.combinedScoreReport },
  }[name];
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, relativePath(repoRoot, value)]),
  );
}

function ingestArgs(options, artifacts) {
  const args = [
    '--user',
    options.userId,
    '--corpus',
    options.corpusId,
    '--documents-root',
    options.documentsRoot,
    '--out',
    artifacts.ingestionRun,
    '--backend-url',
    options.backendUrl,
    '--graphql-url',
    options.graphqlUrl,
    '--auth-token',
    options.authToken,
    '--run-id',
    options.runId,
  ];
  if (options.resetMemory) args.push('--reset-memory');
  if (!options.ensureDefinitions) args.push('--skip-ensure-definitions');
  if (!options.autoApply) args.push('--no-auto-apply');
  if (options.seedPreferencesPath) {
    args.push('--seed-preferences', options.seedPreferencesPath);
  }
  if (options.locationId) args.push('--location-id', options.locationId);
  return args;
}

function exportArgs(options, artifacts) {
  const args = [
    '--user',
    options.userId,
    '--corpus',
    options.corpusId,
    '--out',
    artifacts.storedPreferences,
    '--graphql-url',
    options.graphqlUrl,
    '--auth-token',
    options.authToken,
    '--ingestion-mode',
    INGESTION_MODE,
    '--suggestions-were-auto-applied',
    String(options.autoApply),
    '--run-id',
    options.runId,
  ];
  if (options.locationId) args.push('--location-id', options.locationId);
  return args;
}

function markRemainingStagesSkipped(report, failedStageName) {
  let afterFailed = false;
  for (const stage of report.stages) {
    if (afterFailed && stage.status === 'pending') {
      stage.status = 'skipped';
    }
    if (stage.name === failedStageName) {
      afterFailed = true;
    }
  }
}

function activeStageName(report) {
  return report.stages.find((stage) => stage.status === 'running')?.name ?? null;
}

function failureLines({ report, reportPath, repoRoot, stageName }) {
  const stage = report.stages.find((candidate) => candidate.name === stageName);
  const lines = [
    'eval e2e-known-schema failed',
    `stage=${stageName}`,
    `runId=${report.runId}`,
    `artifacts=${report.artifactsRoot}`,
    `wrote ${relativePath(repoRoot, reportPath)}`,
  ];
  if (stage?.artifacts?.response) {
    lines.push(`response=${stage.artifacts.response}`);
  }
  return [...lines, '', ...(stage?.lines ?? [])];
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function durationMs(startedAt, endedAt) {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}

function generatedRunId(options, now) {
  return [
    'known-schema',
    options.userId,
    options.corpusId,
    isoTimestamp(now).replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, ''),
  ].join('-');
}

function modelMetadata(options) {
  if (options.modelLabel) {
    return {
      label: options.modelLabel,
      source: 'manual',
    };
  }
  return {
    label: null,
    source: 'unspecified',
  };
}

function redactLines(lines, secret) {
  return lines.map((line) => redactSecret(String(line), secret));
}

function redactSecret(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('[redacted-auth-token]');
}

function sanitizeUrlForArtifact(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runKnownSchemaE2E({ args: process.argv.slice(2) });
  console.log(formatKnownSchemaE2EResult(result));
  process.exitCode = result.exitCode;
}
