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
  assert.doesNotMatch(missing.lines.join('\n'), /--user-id/);

  const requiredArgs = [
    '--user',
    'alex-i9-test',
    '--corpus',
    'realistic',
    '--scenario',
    'alex-i9-realistic',
    '--artifacts-root',
    '/tmp/eval-artifacts',
  ];
  for (const [flag, expected] of [
    ['--user', 'Missing required --user'],
    ['--corpus', 'Missing required --corpus'],
    ['--scenario', 'Missing required --scenario'],
    ['--artifacts-root', 'Missing required --artifacts-root'],
  ]) {
    const args = removeFlagValue(requiredArgs, flag);
    const parsed = parseArgs(args, { EVAL_AUTH_TOKEN: 'token' }, fixedNow);
    assert.equal(parsed.kind, 'usage-error');
    assert.equal(parsed.message, expected);
    assert.doesNotMatch(parsed.message, /--user-id|--corpus-id|--scenario-id/);
  }

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
    EVAL_MODEL_LABEL: 'env-model',
  };

  const envFallback = parseArgs(baseArgs, env, fixedNow);
  assert.equal(envFallback.kind, 'ok');
  assert.equal(envFallback.options.backendUrl, 'http://env-backend');
  assert.equal(envFallback.options.graphqlUrl, 'http://env-graphql');
  assert.equal(envFallback.options.authToken, 'env-token');
  assert.equal(envFallback.options.modelLabel, 'env-model');
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
      '--model-label',
      'cli-model',
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
  assert.equal(cliOverride.options.modelLabel, 'cli-model');
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
      '--model-label',
      'gemini-2.5-pro',
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
  assert.equal(evaluationRun.schemaVersion, 2);
  assert.equal(evaluationRun.status, 'pass');
  assert.equal(evaluationRun.runId, 'run-123');
  assert.equal(evaluationRun.backendUserId, 'backend-user-123');
  assert.deepEqual(evaluationRun.model, {
    label: 'gemini-2.5-pro',
    source: 'manual',
  });
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

test('known-schema e2e records unspecified model metadata when no label is provided', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'known-schema-e2e-model-'));
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
      'token',
      '--run-id',
      'run-unspecified-model',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const evaluationRun = JSON.parse(
    await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'),
  );
  assert.deepEqual(evaluationRun.model, {
    label: null,
    source: 'unspecified',
  });
  assert.equal(evaluationRun.schemaVersion, 2);
  await validateWithSchema(
    repoRoot,
    'evaluation-run.schema.json',
    evaluationRun,
    'evaluation run',
  );
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
  assert.match(result.lines.join('\n'), new RegExp(`artifacts=${escapeRegExp(path.relative(repoRoot, tmp))}`));
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

test('known-schema e2e failed fill-form stage prints response artifact path', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'known-schema-e2e-fill-fail-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    fillForm: async ({ args }) => {
      calls.push({ stage: 'fill-form', args });
      await writeArtifact(argValue(args, '--response-out'), {
        schemaVersion: 1,
        artifactType: 'form-fill-response',
      });
      return {
        exitCode: 1,
        lines: [
          'eval fill-form failed',
          'response examples should still be visible',
        ],
      };
    },
  };

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
      'token',
      '--run-id',
      'run-fill-failure',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  const output = result.lines.join('\n');
  assert.match(output, /stage=fill-form/);
  assert.match(output, new RegExp(`artifacts=${escapeRegExp(path.relative(repoRoot, tmp))}`));
  assert.match(
    output,
    new RegExp(`response=${escapeRegExp(path.relative(repoRoot, path.join(tmp, 'form-fill-response.json')))}`),
  );
});

test('known-schema e2e includes formatted validation details when validation fails', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'known-schema-e2e-validation-fail-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    validate: async ({ args }) => {
      calls.push({ stage: 'validate', args });
      const reportPath = argValue(args, '--report-out');
      await writeArtifact(reportPath, {
        schemaVersion: 1,
        status: 'fail',
        summary: { errors: 1, warnings: 0 },
        corpusTruth: {
          summary: {
            hardFailures: 1,
            unsupportedDeclaredFacts: 0,
            factsMissing: 1,
            unsupportedDeclaredFactKeys: [],
          },
          documents: [],
        },
        issues: [],
      });
      return {
        exitCode: 1,
        repoRoot,
        reportPath,
        summary: {
          profiles: 1,
          corpora: 1,
          forms: 0,
          scenarios: 0,
          templates: 0,
          errors: 1,
          warnings: 0,
        },
        issues: [
          {
            level: 'error',
            code: 'DOCUMENT_FACT_VALUE_MISSING',
            file: 'examples/eval/users/alex-i9-test/corpora/realistic/manifest.json',
            pointer: '/documents/0/factContract/include/0',
            message: 'Document declares identity.legalName, but the value was missing.',
            fix: 'Add the declared fact value to the document body.',
          },
        ],
      };
    },
  };

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
      'token',
      '--run-id',
      'run-validation-failure',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(calls.map((call) => call.stage), ['validate']);
  assert.match(result.lines.join('\n'), /DOCUMENT_FACT_VALUE_MISSING/);
  assert.match(result.lines.join('\n'), /identity\.legalName/);

  const evaluationRun = JSON.parse(
    await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'),
  );
  const validationStage = evaluationRun.stages.find(
    (stage) => stage.name === 'validate-documents',
  );
  assert.equal(validationStage.status, 'failed');
  assert.match(validationStage.lines.join('\n'), /DOCUMENT_FACT_VALUE_MISSING/);
  assert.match(validationStage.lines.join('\n'), /identity\.legalName/);
  assert.deepEqual(
    evaluationRun.stages.slice(1).map((stage) => [stage.name, stage.status]),
    [
      ['ingest-documents', 'skipped'],
      ['export-stored-preferences', 'skipped'],
      ['score-database', 'skipped'],
      ['fill-form', 'skipped'],
      ['score-form', 'skipped'],
      ['score-combined', 'skipped'],
    ],
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

function removeFlagValue(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return [...args.slice(0, index), ...args.slice(index + 2)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
