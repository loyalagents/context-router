import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  runKnownSchemaE2E,
} from './e2e-known-schema.mjs';
import { validateWithSchema } from './scoring/io.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-01T12:00:00.000Z');

test('known-schema e2e CLI prints help and reports invalid args clearly', async () => {
  const help = await runKnownSchemaE2E({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:e2e-known-schema/);

  const missing = await runKnownSchemaE2E({ repoRoot, args: [], env: {} });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.lines.join('\n'), /Missing required --user/);

  const noToken = parseArgs(
    [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      '/tmp/eval-artifacts',
    ],
    {},
    fixedNow,
  );
  assert.equal(noToken.kind, 'usage-error');
  assert.match(noToken.message, /EVAL_AUTH_TOKEN/);
});

test('known-schema e2e parseArgs handles defaults, env fallback, and CLI override', () => {
  const baseArgs = [
    '--user',
    'alex-i9-test',
    '--corpus',
    'realistic',
    '--scenario',
    'alex-i9-realistic',
    '--artifacts-root',
    '/tmp/eval-artifacts',
  ];
  const env = {
    EVAL_BACKEND_URL: 'http://env-backend',
    EVAL_GRAPHQL_URL: 'http://env-graphql',
    EVAL_AUTH_TOKEN: 'env-token',
  };

  const envFallback = parseArgs(baseArgs, env, fixedNow);
  assert.equal(envFallback.kind, 'ok');
  assert.equal(envFallback.options.backendUrl, 'http://env-backend');
  assert.equal(envFallback.options.graphqlUrl, 'http://env-graphql');
  assert.equal(envFallback.options.authToken, 'env-token');
  assert.equal(
    envFallback.options.documentsRoot,
    'examples/eval/users/alex-i9-test/corpora/realistic',
  );
  assert.match(
    envFallback.options.runId,
    /^known-schema-alex-i9-test-realistic-2026-06-01T12-00-00-000Z$/,
  );

  const cliOverride = parseArgs(
    [
      ...baseArgs,
      '--documents-root',
      '/private/tmp/docs',
      '--backend-url',
      'http://cli-backend',
      '--graphql-url',
      'http://cli-graphql',
      '--auth-token',
      'cli-token',
      '--run-id',
      'run-123',
    ],
    env,
    fixedNow,
  );
  assert.equal(cliOverride.kind, 'ok');
  assert.equal(cliOverride.options.documentsRoot, '/private/tmp/docs');
  assert.equal(cliOverride.options.backendUrl, 'http://cli-backend');
  assert.equal(cliOverride.options.graphqlUrl, 'http://cli-graphql');
  assert.equal(cliOverride.options.authToken, 'cli-token');
  assert.equal(cliOverride.options.runId, 'run-123');
});

test('known-schema e2e runs stages in order and writes a schema-valid evaluation run', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'known-schema-e2e-'));
  const calls = [];
  const runners = successfulRunners({ calls });

  const result = await runKnownSchemaE2E({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      tmp,
      '--auth-token',
      'secret-token',
      '--backend-url',
      'http://user:pass@localhost:3000',
      '--graphql-url',
      'http://user:pass@localhost:3000/graphql',
      '--reset-memory',
      '--skip-ensure-definitions',
      '--no-auto-apply',
      '--seed-preferences',
      '/private/tmp/seeds.json',
      '--location-id',
      'loc-1',
      '--run-id',
      'run-123',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.deepEqual(
    calls.map((call) => call.stage),
    [
      'validate',
      'ingest',
      'export',
      'score:database',
      'fill-form',
      'score:form',
      'score:combined',
    ],
  );

  const evaluationRunPath = path.join(tmp, 'evaluation-run.json');
  const evaluationRun = JSON.parse(await readFile(evaluationRunPath, 'utf8'));
  await validateWithSchema(
    repoRoot,
    'evaluation-run.schema.json',
    evaluationRun,
    'evaluation run',
  );
  assert.equal(evaluationRun.status, 'pass');
  assert.equal(evaluationRun.runId, 'run-123');
  assert.equal(evaluationRun.backendUserId, 'backend-user-123');
  assert.equal(evaluationRun.backendUrl, 'http://localhost:3000/');
  assert.equal(evaluationRun.graphqlUrl, 'http://localhost:3000/graphql');
  assert.equal(evaluationRun.settings.resetMemory, true);
  assert.equal(evaluationRun.settings.ensureDefinitions, false);
  assert.equal(evaluationRun.settings.autoApply, false);
  assert.equal(evaluationRun.settings.seedPreferences, true);
  assert.deepEqual(
    evaluationRun.stages.map((stage) => stage.status),
    ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed'],
  );
  assert.equal(JSON.stringify(evaluationRun).includes('secret-token'), false);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);

  const ingestArgs = calls.find((call) => call.stage === 'ingest').args;
  assert.equal(ingestArgs.includes('--reset-memory'), true);
  assert.equal(ingestArgs.includes('--skip-ensure-definitions'), true);
  assert.equal(ingestArgs.includes('--no-auto-apply'), true);
  assert.equal(ingestArgs.includes('--seed-preferences'), true);
  assert.equal(ingestArgs.includes('--location-id'), true);
  assert.equal(ingestArgs.includes('--export-stored-preferences'), false);
  assert.equal(ingestArgs.includes('--database-score-report'), false);

  const exportArgs = calls.find((call) => call.stage === 'export').args;
  assert.equal(argValue(exportArgs, '--suggestions-were-auto-applied'), 'false');
  assert.equal(argValue(exportArgs, '--location-id'), 'loc-1');
  assert.equal(argValue(exportArgs, '--run-id'), 'run-123');

  const databaseScoreArgs = calls.find((call) => call.stage === 'score:database').args;
  assert.equal(argValue(databaseScoreArgs, '--validation-report'), path.join(tmp, 'validation-report.json'));

  const fillArgs = calls.find((call) => call.stage === 'fill-form').args;
  assert.equal(fillArgs.includes('--form-score-report'), false);
  assert.equal(argValue(fillArgs, '--filled-pdf-out'), path.join(tmp, 'filled-form.pdf'));
  assert.equal(argValue(fillArgs, '--response-out'), path.join(tmp, 'form-fill-response.json'));
});

test('known-schema e2e writes partial evaluation run and skips later stages on failure', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'known-schema-e2e-fail-'));
  const calls = [];
  const runners = successfulRunners({
    calls,
    failures: {
      exportStoredPreferences: {
        exitCode: 1,
        lines: ['export failed because secret-token was rejected'],
      },
    },
  });

  const result = await runKnownSchemaE2E({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--scenario',
      'alex-i9-realistic',
      '--artifacts-root',
      tmp,
      '--auth-token',
      'secret-token',
      '--run-id',
      'run-failure',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /stage=export-stored-preferences/);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);
  assert.match(result.lines.join('\n'), /\[redacted-auth-token\]/);
  assert.deepEqual(
    calls.map((call) => call.stage),
    ['validate', 'ingest', 'export'],
  );

  const evaluationRun = JSON.parse(
    await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'),
  );
  assert.equal(evaluationRun.status, 'fail');
  assert.equal(evaluationRun.failureStage, 'export-stored-preferences');
  assert.equal(
    evaluationRun.stages.find((stage) => stage.name === 'export-stored-preferences').status,
    'failed',
  );
  assert.deepEqual(
    evaluationRun.stages.slice(3).map((stage) => [stage.name, stage.status]),
    [
      ['score-database', 'skipped'],
      ['fill-form', 'skipped'],
      ['score-form', 'skipped'],
      ['score-combined', 'skipped'],
    ],
  );
  assert.equal(JSON.stringify(evaluationRun).includes('secret-token'), false);
  await validateWithSchema(
    repoRoot,
    'evaluation-run.schema.json',
    evaluationRun,
    'evaluation run',
  );
});

function successfulRunners({ calls, failures = {} }) {
  return {
    validate: async ({ args }) => {
      calls.push({ stage: 'validate', args });
      await writeArtifact(argValue(args, '--report-out'), {
        schemaVersion: 1,
        status: 'pass',
        summary: { errors: 0, warnings: 0 },
        corpusTruth: {
          summary: {
            hardFailures: 0,
            unsupportedDeclaredFacts: 0,
            factsMissing: 0,
            unsupportedDeclaredFactKeys: [],
          },
          documents: [],
        },
        issues: [],
      });
      return { exitCode: 0, lines: ['validation passed'] };
    },
    ingest: async ({ args }) => {
      calls.push({ stage: 'ingest', args });
      await writeArtifact(argValue(args, '--out'), {
        schemaVersion: 1,
        artifactType: 'ingestion-run',
        status: 'pass',
        runId: argValue(args, '--run-id'),
        evalUserId: argValue(args, '--user'),
        corpusId: argValue(args, '--corpus'),
        backendUserId: 'backend-user-123',
        summary: { documentCount: 10, appliedSuggestionCount: 3 },
      });
      return { exitCode: 0, lines: ['ingest passed'] };
    },
    exportStoredPreferences: async ({ args }) => {
      calls.push({ stage: 'export', args });
      if (failures.exportStoredPreferences) return failures.exportStoredPreferences;
      await writeArtifact(argValue(args, '--out'), {
        schemaVersion: 1,
        artifactType: 'stored-preferences',
        runId: argValue(args, '--run-id'),
        userId: argValue(args, '--user'),
        corpusId: argValue(args, '--corpus'),
        storageInput: {
          ingestionMode: 'known-schema-e2e',
          statusesScored: ['ACTIVE'],
          suggestionsWereAutoApplied: argValue(args, '--suggestions-were-auto-applied') === 'true',
        },
        preferences: [{ slug: 'profile.full_name', value: 'Alex Jordan Rivera', status: 'ACTIVE' }],
        diagnostics: {
          backendUserId: 'backend-user-123',
        },
      });
      return { exitCode: 0, lines: ['export passed'] };
    },
    score: async ({ args }) => {
      const mode = argValue(args, '--mode');
      calls.push({ stage: `score:${mode}`, args });
      if (mode === 'database') {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'database-storage',
          summary: { knownPresentTotal: 1, knownPresentCorrect: 0 },
        });
      } else if (mode === 'form') {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'form-fill',
          summary: { knownFieldTotal: 1, knownFieldCorrect: 0 },
        });
      } else {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'combined',
          summary: { factTotal: 1, stageAttributionCounts: {} },
        });
      }
      return { exitCode: 0, lines: [`score ${mode} passed`] };
    },
    fillForm: async ({ args }) => {
      calls.push({ stage: 'fill-form', args });
      await writeArtifact(argValue(args, '--out'), {
        schemaVersion: 1,
        snapshotType: 'filled-form',
        response: { status: 'success' },
        fields: [],
      });
      await writeFile(argValue(args, '--filled-pdf-out'), Buffer.from('%PDF fake\n'));
      await writeArtifact(argValue(args, '--response-out'), {
        schemaVersion: 1,
        artifactType: 'form-fill-response',
      });
      return { exitCode: 0, lines: ['fill passed'] };
    },
  };
}

async function writeArtifact(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, jsonText(value));
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
