import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, validate } from 'graphql';
import {
  lowTrustSourceForDocument,
  parseArgs,
  runIngestDocuments,
} from './ingest-documents.mjs';
import { INGESTOR_GRAPHQL_DOCUMENTS } from './ingestor/query.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-01T12:00:00.000Z');
const alexDocumentsRoot = 'examples/eval/users/alex-i9-test/corpora/realistic';

test('ingestor GraphQL documents validate against backend schema', async () => {
  const schemaText = await readFile(
    path.join(repoRoot, 'apps/backend/src/schema.gql'),
    'utf8',
  );
  const schema = buildSchema(schemaText);
  const errors = INGESTOR_GRAPHQL_DOCUMENTS.flatMap((document) =>
    validate(schema, parse(document)).map((error) => error.message),
  );
  assert.deepEqual(errors, []);
});

test('ingest CLI prints help and reports invalid arguments clearly', async () => {
  const help = await runIngestDocuments({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:ingest-documents/);

  const invalid = await runIngestDocuments({
    repoRoot,
    args: ['--user', 'alex-i9-test'],
    env: {},
  });
  assert.equal(invalid.exitCode, 2);
  assert.match(invalid.lines.join('\n'), /Missing required --corpus/);

  const scoreWithoutExport = parseArgs(
    [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      '/tmp/run.json',
      '--database-score-report',
      '/tmp/db.json',
    ],
    { EVAL_AUTH_TOKEN: 'token' },
  );
  assert.equal(scoreWithoutExport.kind, 'usage-error');
  assert.match(scoreWithoutExport.message, /--export-stored-preferences/);
});

test('ingest CLI uses env fallback and explicit CLI override', () => {
  const baseArgs = [
    '--user',
    'alex-i9-test',
    '--corpus',
    'realistic',
    '--documents-root',
    alexDocumentsRoot,
    '--out',
    '/tmp/ingestion-run.json',
  ];
  const env = {
    EVAL_BACKEND_URL: 'http://env-backend',
    EVAL_GRAPHQL_URL: 'http://env-graphql',
    EVAL_AUTH_TOKEN: 'env-token',
  };

  const envFallback = parseArgs(baseArgs, env);
  assert.equal(envFallback.kind, 'ok');
  assert.equal(envFallback.options.backendUrl, 'http://env-backend');
  assert.equal(envFallback.options.graphqlUrl, 'http://env-graphql');
  assert.equal(envFallback.options.authToken, 'env-token');

  const cliOverride = parseArgs(
    [
      ...baseArgs,
      '--backend-url',
      'http://cli-backend',
      '--graphql-url',
      'http://cli-graphql',
      '--auth-token',
      'cli-token',
    ],
    env,
  );
  assert.equal(cliOverride.kind, 'ok');
  assert.equal(cliOverride.options.backendUrl, 'http://cli-backend');
  assert.equal(cliOverride.options.graphqlUrl, 'http://cli-graphql');
  assert.equal(cliOverride.options.authToken, 'cli-token');
});

test('low-trust source detection normalizes punctuation, spacing, and case', () => {
  const result = lowTrustSourceForDocument({
    evaluationRole: {
      freshness: ' Superseded ',
      authority: 'Medium',
      expectedUse: 'Needs Review',
      challengeTags: ['Partial Conflicting', 'safe-detail'],
    },
    sourceSpec: {
      sourceFamily: 'PARTIAL_conflicting',
    },
  });

  assert.equal(result.lowTrustSource, true);
  assert.deepEqual(result.lowTrustSignals, [
    'freshness: Superseded ',
    'challengeTag:Partial Conflicting',
    'sourceFamily:PARTIAL_conflicting',
  ]);

  assert.deepEqual(
    lowTrustSourceForDocument({
      evaluationRole: {
        freshness: 'current',
        authority: 'high',
        expectedUse: 'extract',
        challengeTags: ['identity-evidence'],
      },
      sourceSpec: {
        sourceFamily: 'identity',
      },
    }),
    {
      lowTrustSource: false,
      lowTrustSignals: [],
    },
  );
});

test('ingest-documents resets, ensures definitions, uploads, applies, exports, and scores', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const prefsPath = path.join(tmp, 'stored-preferences.json');
  const dbReportPath = path.join(tmp, 'database-score-report.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        analysisId: 'analysis-001',
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'profile.full_name',
            newValue: 'Alex Jordan Rivera',
          }),
        ],
      }),
    ],
    activePreferences: [
      pref({
        id: 'pref-active-1',
        userId: 'backend-user-123',
        slug: 'profile.full_name',
        value: 'Alex Jordan Rivera',
      }),
    ],
    existingDefinitions: ['profile.full_name'],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'secret-token',
      '--backend-url',
      'http://localhost:3000',
      '--graphql-url',
      'http://localhost:3000/graphql',
      '--reset-memory',
      '--export-stored-preferences',
      prefsPath,
      '--database-score-report',
      dbReportPath,
      '--run-id',
      'run-123',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.status, 'pass');
  assert.equal(report.evalUserId, 'alex-i9-test');
  assert.equal(report.backendUserId, 'backend-user-123');
  assert.equal(report.settings.resetMemory, true);
  assert.equal(report.settings.ensureDefinitions, true);
  assert.equal(report.settings.autoApply, true);
  assert.equal(report.summary.documentCount, 10);
  assert.equal(report.summary.uploadedCount, 10);
  assert.equal(report.summary.analyzedCount, 10);
  assert.equal(report.summary.appliedSuggestionCount, 1);
  assert.equal(report.summary.applyFailureCount, 0);
  assert.ok(report.summary.createdDefinitionCount > 0);
  assert.equal(
    report.definitionSetup.existing.some((definition) => definition.slug === 'profile.full_name'),
    true,
  );
  assert.equal(report.export.path, path.relative(repoRoot, prefsPath).split(path.sep).join('/'));
  assert.equal(report.databaseScore.path, path.relative(repoRoot, dbReportPath).split(path.sep).join('/'));

  const storedPreferences = JSON.parse(await readFile(prefsPath, 'utf8'));
  assert.equal(storedPreferences.userId, 'alex-i9-test');
  assert.equal(storedPreferences.preferences[0].userId, 'backend-user-123');
  assert.equal(storedPreferences.diagnostics.backendUserId, 'backend-user-123');
  assert.equal(JSON.stringify(report).includes('secret-token'), false);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);

  const databaseReport = JSON.parse(await readFile(dbReportPath, 'utf8'));
  assert.equal(databaseReport.scoreType, 'database-storage');

  const operationNames = fetchMock.calls
    .filter((call) => call.kind === 'graphql')
    .map((call) => call.operationName);
  assert.deepEqual(operationNames.slice(0, 3), [
    'EvalIngestorMe',
    'EvalIngestorResetMemory',
    'EvalIngestorPreferenceSchema',
  ]);
  assert.equal(fetchMock.calls.filter((call) => call.kind === 'upload').length, 10);
  assert.equal(
    fetchMock.createDefinitionInputs.some((input) => input.slug === 'profile.full_name'),
    false,
  );
  assert.equal(
    fetchMock.createDefinitionInputs.some((input) => input.slug === 'eval.contact.phone'),
    true,
  );
  assert.equal(fetchMock.applyInputs[0][0].suggestionId, 'analysis-001:candidate:0');
  assert.equal(fetchMock.applyInputs[0][0].evidence.source, 'eval-ingestor-upload');
});

test('ingest-documents fails definition setup when an existing slug has the wrong value type', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-def-type-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    existingDefinitions: [
      {
        slug: 'profile.full_name',
        valueType: 'BOOLEAN',
      },
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /Existing definition profile\.full_name has valueType BOOLEAN, expected STRING/);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.documents.length, 0);
  assert.equal(fetchMock.calls.some((call) => call.kind === 'upload'), false);
});

test('ingest-documents continues after soft analysis failures, then exports and scores partial state', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-soft-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const prefsPath = path.join(tmp, 'stored-preferences.json');
  const dbReportPath = path.join(tmp, 'database-score-report.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      analysisFailureUpload({
        analysisId: 'analysis-parse',
        status: 'parse_error',
        statusReason: 'Parser could not read page 1',
      }),
      successUpload({
        analysisId: 'analysis-002',
        suggestions: [
          suggestion({
            id: 'analysis-002:candidate:0',
            slug: 'profile.full_name',
            newValue: 'Alex Jordan Rivera',
          }),
        ],
      }),
    ],
    activePreferences: [
      pref({
        id: 'pref-active-1',
        userId: 'backend-user-123',
        slug: 'profile.full_name',
        value: 'Alex Jordan Rivera',
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--export-stored-preferences',
      prefsPath,
      '--database-score-report',
      dbReportPath,
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.documents.length, 10);
  assert.equal(report.documents[0].status, 'parse_error');
  assert.equal(report.documents[0].error, 'Parser could not read page 1');
  assert.equal(report.documents[1].status, 'success');
  assert.equal(report.summary.failedDocumentCount, 1);
  assert.equal(report.summary.uploadedCount, 9);
  assert.equal(report.summary.analyzedCount, 10);
  assert.equal(report.summary.appliedSuggestionCount, 1);
  assert.equal(report.export.path, path.relative(repoRoot, prefsPath).split(path.sep).join('/'));
  assert.equal(report.databaseScore.path, path.relative(repoRoot, dbReportPath).split(path.sep).join('/'));
  assert.equal(fetchMock.calls.filter((call) => call.kind === 'upload').length, 10);
  assert.equal(fetchMock.applyInputs.length, 1);

  const storedPreferences = JSON.parse(await readFile(prefsPath, 'utf8'));
  assert.equal(storedPreferences.preferences[0].slug, 'profile.full_name');
  const databaseReport = JSON.parse(await readFile(dbReportPath, 'utf8'));
  assert.equal(databaseReport.scoreType, 'database-storage');
});

test('ingest-documents can skip definition setup and auto-apply', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-skip-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [suggestion({ slug: 'profile.first_name', newValue: 'Alex' })],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--no-auto-apply',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.settings.ensureDefinitions, false);
  assert.equal(report.settings.autoApply, false);
  assert.equal(report.definitionSetup.created.length, 0);
  assert.ok(report.definitionSetup.skipped.length > 0);
  assert.equal(report.summary.suggestionCount, 1);
  assert.equal(report.summary.appliedSuggestionCount, 0);
  assert.equal(report.documents[0].suggestionDecisions[0].decision, 'skipped');
  assert.deepEqual(report.documents[0].suggestionDecisions[0].reasons, [
    'auto_apply_disabled',
  ]);
  assert.equal(fetchMock.createDefinitionInputs.length, 0);
  assert.equal(fetchMock.applyInputs.length, 0);
});

test('ingest-documents validates suggestion item shape even when auto-apply is disabled', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-suggestion-shape-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [
          {
            ...suggestion({ slug: 'profile.full_name' }),
            sourceSnippet: undefined,
          },
        ].map(({ sourceSnippet: _sourceSnippet, ...rest }) => rest),
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--no-auto-apply',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.documents.length, 1);
  assert.match(report.documents[0].error, /suggestion 0 is missing sourceSnippet/);
  assert.equal(fetchMock.applyInputs.length, 0);
});

test('ingest-documents writes explicit seed preferences before upload', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-seed-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const seedPath = path.join(tmp, 'seed-preferences.json');
  await writeFile(
    seedPath,
    jsonText([{ slug: 'profile.first_name', value: 'Alex' }]),
  );
  const fetchMock = createFetchMock();

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--seed-preferences',
      seedPath,
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.summary.seedPreferenceCount, 1);
  assert.deepEqual(fetchMock.setPreferenceInputs, [
    { slug: 'profile.first_name', value: 'Alex' },
  ]);
  const setIndex = fetchMock.calls.findIndex((call) => call.operationName === 'EvalIngestorSetPreference');
  const uploadIndex = fetchMock.calls.findIndex((call) => call.kind === 'upload');
  assert.ok(setIndex > -1);
  assert.ok(uploadIndex > setIndex);
});

test('ingest-documents rejects pagination-looking upload responses', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-page-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      {
        ...successUpload(),
        pageInfo: { hasNextPage: true },
      },
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /appears paginated/);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.summary.failedDocumentCount, 1);
});

test('ingest-documents fails clearly when upload suggestions are missing', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-missing-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const prefsPath = path.join(tmp, 'stored-preferences.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      {
        analysisId: 'analysis-001',
        status: 'success',
        filteredSuggestions: [],
        filteredCount: 0,
      },
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--export-stored-preferences',
      prefsPath,
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /suggestions must be an array/);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.export, undefined);
  assert.equal(fetchMock.calls.some((call) => call.operationName === 'EvalStoredPreferencesExport'), false);
});

test('ingest-documents treats apply failures as hard failures before export', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-apply-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const prefsPath = path.join(tmp, 'stored-preferences.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [suggestion({ slug: 'profile.full_name' })],
      }),
    ],
    applyErrors: ['apply failed after validation'],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--export-stored-preferences',
      prefsPath,
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.documents.length, 1);
  assert.equal(report.documents[0].status, 'apply_error');
  assert.match(report.documents[0].error, /apply failed after validation/);
  assert.equal(report.summary.applyFailureCount, 1);
  assert.equal(report.export, undefined);
  assert.equal(fetchMock.calls.filter((call) => call.kind === 'upload').length, 1);
  assert.equal(fetchMock.calls.some((call) => call.operationName === 'EvalStoredPreferencesExport'), false);
});

test('ingest-documents treats partial apply success as a hard failure before export', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-apply-partial-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const prefsPath = path.join(tmp, 'stored-preferences.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'profile.full_name',
            newValue: 'Alex Jordan Rivera',
          }),
          suggestion({
            id: 'analysis-001:candidate:1',
            slug: 'profile.first_name',
            newValue: 'Alex',
          }),
        ],
      }),
    ],
    applyResultCounts: [1],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--export-stored-preferences',
      prefsPath,
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.documents.length, 1);
  assert.equal(report.documents[0].status, 'apply_error');
  assert.equal(report.documents[0].appliedSuggestionCount, 1);
  assert.match(report.documents[0].error, /Applied 1\/2 suggestions/);
  assert.equal(report.summary.applyFailureCount, 1);
  assert.equal(report.export, undefined);
  assert.equal(fetchMock.calls.some((call) => call.operationName === 'EvalStoredPreferencesExport'), false);
});

test('ingest-documents skips null suggestions before auto-apply', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-apply-null-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'profile.first_name',
            newValue: 'Alex',
          }),
          suggestion({
            id: 'analysis-001:candidate:1',
            slug: 'eval.contact.phone',
            newValue: null,
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.documents[0].status, 'success');
  assert.equal(report.documents[0].suggestionCount, 2);
  assert.equal(report.documents[0].appliedSuggestionCount, 1);
  assert.deepEqual(
    fetchMock.applyInputs[0].map((input) => input.slug),
    ['profile.first_name'],
  );
  assert.equal(report.documents[0].autoApplySkippedSuggestions.length, 1);
  assert.equal(
    report.documents[0].autoApplySkippedSuggestions[0].filterReason,
    'NON_STORABLE_NULL_VALUE',
  );
  assert.equal(report.summary.applyFailureCount, 0);
});

test('ingest-documents skips blank and whitespace suggestions before auto-apply', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-blank-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'profile.first_name',
            newValue: 'Alex',
          }),
          suggestion({
            id: 'analysis-001:candidate:1',
            slug: 'eval.address.current.street',
            newValue: '',
          }),
          suggestion({
            id: 'analysis-001:candidate:2',
            slug: 'eval.address.current.unit',
            newValue: '   ',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.schemaVersion, 2);
  assert.deepEqual(
    fetchMock.applyInputs[0].map((input) => input.slug),
    ['profile.first_name'],
  );
  assert.equal(report.documents[0].suggestionDecisions.length, 3);
  assert.deepEqual(
    report.documents[0].suggestionDecisions.map((decision) => decision.decision),
    ['applied', 'skipped', 'skipped'],
  );
  assert.deepEqual(
    report.documents[0].suggestionDecisions.slice(1).map((decision) => decision.reasons),
    [
      ['blank_value'],
      ['blank_value'],
    ],
  );
  assert.equal(report.summary.blankSuggestionSkippedCount, 2);
  assert.equal(report.documents[0].autoApplySkippedSuggestions.length, 2);
});

test('ingest-documents does not classify arrays or objects as blank values', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-composite-values-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'profile.first_name',
            newValue: [],
          }),
          suggestion({
            id: 'analysis-001:candidate:1',
            slug: 'eval.identity.middle_initial',
            newValue: {},
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--no-auto-apply',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.deepEqual(
    report.documents[0].suggestionDecisions.map((decision) => decision.reasons),
    [
      ['auto_apply_disabled'],
      ['auto_apply_disabled'],
    ],
  );
  assert.equal(report.summary.blankSuggestionSkippedCount, 0);
  assert.equal(fetchMock.applyInputs.length, 0);
});

test('ingest-documents blocks forbidden suggestions even when no value exists', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-forbidden-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      ...Array.from({ length: 8 }, (_value, index) => noMatchesUpload(`analysis-${index + 1}`)),
      successUpload({
        analysisId: 'analysis-009',
        suggestions: [
          suggestion({
            id: 'analysis-009:candidate:0',
            slug: 'profile.email',
            newValue: 'stale@example.test',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  const staleDoc = report.documents[8];
  assert.equal(staleDoc.path, 'documents/partial-conflicting/009-stale-contact-ticket.txt');
  assert.equal(fetchMock.applyInputs.length, 0);
  assert.equal(staleDoc.suggestionDecisions[0].decision, 'blocked');
  assert.deepEqual(staleDoc.suggestionDecisions[0].reasons, ['forbidden_fact']);
  assert.equal(report.summary.forbiddenSuggestionBlockedCount, 1);
  assert.equal(report.summary.staleOrNoiseOverwriteBlockedCount, 0);
  assert.equal(report.summary.overwriteCount, 0);
});

test('ingest-documents allows document includes to override default forbidden facts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-forbidden-include-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      noMatchesUpload('analysis-001'),
      successUpload({
        analysisId: 'analysis-002',
        suggestions: [
          suggestion({
            id: 'analysis-002:candidate:0',
            slug: 'eval.identity.ssn',
            newValue: '000-00-0292',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  const decision = report.documents[1].suggestionDecisions[0];
  assert.equal(report.documents[1].path, 'documents/identity/002-ssn-card-upload-ocr.txt');
  assert.equal(decision.slug, 'eval.identity.ssn');
  assert.equal(decision.decision, 'applied');
  assert.deepEqual(decision.reasons, []);
  assert.equal(Object.hasOwn(decision, 'forbiddenFactKeys'), false);
  assert.deepEqual(fetchMock.applyInputs[0].map((input) => input.slug), [
    'eval.identity.ssn',
  ]);
  assert.equal(report.summary.forbiddenSuggestionBlockedCount, 0);
  assert.equal(report.summary.overwriteCount, 0);
});

test('ingest-documents blocks derived intentionally-missing fact suggestions', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-derived-missing-'));
  const fixture = await writeDerivedMissingFixture(tmp);
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        analysisId: 'analysis-001',
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'eval.contact.phone',
            newValue: '415-555-0100',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot: fixture.repoRoot,
    args: [
      '--user',
      fixture.userId,
      '--corpus',
      fixture.corpusId,
      '--documents-root',
      fixture.documentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  const decision = report.documents[0].suggestionDecisions[0];
  assert.equal(decision.slug, 'eval.contact.phone');
  assert.equal(decision.decision, 'blocked');
  assert.deepEqual(decision.reasons, ['forbidden_fact']);
  assert.deepEqual(decision.forbiddenFactKeys, ['contact.phone']);
  assert.equal(fetchMock.applyInputs.length, 0);
  assert.equal(report.summary.forbiddenSuggestionBlockedCount, 1);
});

test('ingest-documents blocks forbidden accepted-alias slugs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-forbidden-alias-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      ...Array.from({ length: 8 }, (_value, index) => noMatchesUpload(`analysis-${index + 1}`)),
      successUpload({
        analysisId: 'analysis-009',
        suggestions: [
          suggestion({
            id: 'analysis-009:candidate:0',
            slug: 'contact.email',
            newValue: 'stale@example.test',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  const decision = report.documents[8].suggestionDecisions[0];
  assert.equal(decision.slug, 'contact.email');
  assert.equal(decision.decision, 'blocked');
  assert.deepEqual(decision.reasons, ['forbidden_fact']);
  assert.deepEqual(decision.forbiddenFactKeys, ['contact.email']);
  assert.equal(fetchMock.applyInputs.length, 0);
  assert.equal(report.summary.forbiddenSuggestionBlockedCount, 1);
});

test('ingest-documents allows low-trust first writes but blocks low-trust overwrites', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-low-trust-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      ...Array.from({ length: 8 }, (_value, index) => noMatchesUpload(`analysis-${index + 1}`)),
      successUpload({
        analysisId: 'analysis-009',
        suggestions: [
          suggestion({
            id: 'analysis-009:candidate:0',
            slug: 'eval.address.current.city',
            newValue: 'Portland',
          }),
        ],
      }),
      successUpload({
        analysisId: 'analysis-010',
        suggestions: [
          suggestion({
            id: 'analysis-010:candidate:0',
            slug: 'eval.address.current.city',
            newValue: 'Oakmont',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(fetchMock.applyInputs.length, 1);
  assert.deepEqual(fetchMock.applyInputs[0].map((input) => input.slug), [
    'eval.address.current.city',
  ]);
  assert.equal(report.documents[8].suggestionDecisions[0].decision, 'applied');
  assert.equal(report.documents[8].suggestionDecisions[0].lowTrustSource, true);
  assert.equal(report.documents[9].suggestionDecisions[0].decision, 'blocked');
  assert.deepEqual(report.documents[9].suggestionDecisions[0].reasons, [
    'low_trust_source',
    'would_overwrite_non_empty',
  ]);
  assert.equal(report.summary.overwriteCount, 0);
  assert.equal(report.summary.staleOrNoiseOverwriteBlockedCount, 1);
});

test('ingest-documents protects seeded values from bad overwrite classes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-seed-protected-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const seedPath = path.join(tmp, 'seed-preferences.json');
  await writeFile(
    seedPath,
    jsonText([{ slug: 'eval.address.current.city', value: 'Portland' }]),
  );
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        analysisId: 'analysis-001',
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'eval.address.current.city',
            newValue: '   ',
          }),
        ],
      }),
      ...Array.from({ length: 7 }, (_value, index) => noMatchesUpload(`analysis-${index + 2}`)),
      successUpload({
        analysisId: 'analysis-009',
        suggestions: [
          suggestion({
            id: 'analysis-009:candidate:0',
            slug: 'profile.email',
            newValue: 'stale@example.test',
          }),
        ],
      }),
      successUpload({
        analysisId: 'analysis-010',
        suggestions: [
          suggestion({
            id: 'analysis-010:candidate:0',
            slug: 'eval.address.current.city',
            newValue: 'Oakmont',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--seed-preferences',
      seedPath,
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(fetchMock.applyInputs.length, 0);
  assert.deepEqual(report.documents[0].suggestionDecisions[0].reasons, [
    'blank_value',
    'would_overwrite_non_empty_with_blank',
  ]);
  assert.deepEqual(report.documents[8].suggestionDecisions[0].reasons, ['forbidden_fact']);
  assert.deepEqual(report.documents[9].suggestionDecisions[0].reasons, [
    'low_trust_source',
    'would_overwrite_non_empty',
  ]);
  assert.equal(report.summary.blankSuggestionSkippedCount, 1);
  assert.equal(report.summary.forbiddenSuggestionBlockedCount, 1);
  assert.equal(report.summary.staleOrNoiseOverwriteBlockedCount, 1);
  assert.equal(report.summary.overwriteCount, 0);
});

test('ingest-documents counts only applied non-empty overwrites as overwrites', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-overwrite-count-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const seedPath = path.join(tmp, 'seed-preferences.json');
  await writeFile(
    seedPath,
    jsonText([{ slug: 'eval.address.current.city', value: 'Old City' }]),
  );
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        analysisId: 'analysis-001',
        suggestions: [
          suggestion({
            id: 'analysis-001:candidate:0',
            slug: 'eval.address.current.city',
            newValue: 'Portland',
          }),
        ],
      }),
      ...Array.from({ length: 8 }, (_value, index) => noMatchesUpload(`analysis-${index + 2}`)),
      successUpload({
        analysisId: 'analysis-010',
        suggestions: [
          suggestion({
            id: 'analysis-010:candidate:0',
            slug: 'eval.address.current.city',
            newValue: 'Oakmont',
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--seed-preferences',
      seedPath,
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(fetchMock.applyInputs.length, 1);
  assert.equal(report.documents[0].suggestionDecisions[0].decision, 'applied');
  assert.equal(report.documents[0].suggestionDecisions[0].overwroteNonEmpty, true);
  assert.equal(report.documents[9].suggestionDecisions[0].decision, 'blocked');
  assert.equal(report.summary.overwriteCount, 1);
  assert.equal(report.summary.staleOrNoiseOverwriteBlockedCount, 1);
});

test('ingest-documents records out-of-range suggestion confidence without suppressing the report', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-confidence-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      successUpload({
        suggestions: [
          suggestion({
            slug: 'profile.full_name',
            confidence: 1.42,
          }),
        ],
      }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--skip-ensure-definitions',
      '--no-auto-apply',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.documents[0].suggestions[0].confidence, 1.42);
});

test('ingest-documents redacts auth token from failure output', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-token-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'failure-secret-token',
    ],
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        errors: [{ message: 'Unauthorized failure-secret-token' }],
      }),
    now: fixedNow,
  });

  const output = result.lines.join('\n');
  assert.equal(result.exitCode, 1);
  assert.equal(output.includes('failure-secret-token'), false);
  assert.match(output, /\[redacted-auth-token\]/);
});

test('ingest-documents redacts auth token from document-level errors', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ingest-docs-token-doc-'));
  const outPath = path.join(tmp, 'ingestion-run.json');
  const fetchMock = createFetchMock({
    uploadResults: [
      uploadHttpError({ message: 'Upload failed for document-secret-token' }),
    ],
  });

  const result = await runIngestDocuments({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--documents-root',
      alexDocumentsRoot,
      '--out',
      outPath,
      '--auth-token',
      'document-secret-token',
      '--skip-ensure-definitions',
    ],
    env: {},
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  const reportText = await readFile(outPath, 'utf8');
  const report = JSON.parse(reportText);
  assert.equal(reportText.includes('document-secret-token'), false);
  assert.match(report.documents[0].error, /\[redacted-auth-token\]/);
  assert.equal(result.lines.join('\n').includes('document-secret-token'), false);
});

async function writeDerivedMissingFixture(root) {
  const userId = 'derived-missing-user';
  const corpusId = 'derived-missing-corpus';
  const fixtureRepoRoot = root;
  const userRoot = path.join(fixtureRepoRoot, 'examples/eval/users', userId);
  const corpusRoot = path.join(userRoot, 'corpora', corpusId);
  const documentsDir = path.join(corpusRoot, 'documents');
  const scoringRoot = path.join(fixtureRepoRoot, 'examples/eval/scoring');
  const schemasRoot = path.join(fixtureRepoRoot, 'examples/eval/schemas');

  await mkdir(documentsDir, { recursive: true });
  await mkdir(scoringRoot, { recursive: true });
  await mkdir(schemasRoot, { recursive: true });
  await writeFile(
    path.join(schemasRoot, 'ingestion-run.schema.json'),
    await readFile(path.join(repoRoot, 'examples/eval/schemas/ingestion-run.schema.json'), 'utf8'),
  );
  await writeFile(
    path.join(userRoot, 'profile.yaml'),
    ['facts:', '  identity:', '    legalName: Derived Missing User', ''].join('\n'),
  );
  await writeFile(
    path.join(scoringRoot, 'fact-storage-map.v1.json'),
    JSON.stringify({ facts: {} }, null, 2),
  );
  await writeFile(
    path.join(documentsDir, 'current-note.txt'),
    'Current source document that should not infer a phone number.\n',
  );
  await writeFile(
    path.join(corpusRoot, 'manifest.json'),
    JSON.stringify(
      {
        factContractDefaults: { forbid: [] },
        intentionallyMissing: [
          {
            factKey: 'contact.phone',
            forms: [],
            reason: 'Phone is intentionally absent in this fixture.',
            expectedBehavior: 'Do not store a phone value.',
          },
        ],
        documents: [
          {
            id: 'derived-missing-001',
            path: 'documents/current-note.txt',
            category: 'identity',
            title: 'Current Note',
            factContract: { include: ['identity.legalName'], forbid: [] },
            sourceSpec: { sourceFamily: 'identity' },
            evaluationRole: {
              authority: 'high',
              freshness: 'current',
              expectedUse: 'extract',
              challengeTags: [],
            },
          },
        ],
      },
      null,
      2,
    ),
  );

  return {
    repoRoot: fixtureRepoRoot,
    userId,
    corpusId,
    documentsRoot: path.relative(fixtureRepoRoot, corpusRoot),
  };
}

function createFetchMock({
  backendUserId = 'backend-user-123',
  existingDefinitions = [],
  uploadResults = [],
  activePreferences = [],
  applyErrors = [],
  applyResultCounts = [],
} = {}) {
  const calls = [];
  const createDefinitionInputs = [];
  const setPreferenceInputs = [];
  const applyInputs = [];
  let uploadIndex = 0;

  const fetch = async (url, options) => {
    if (String(url).endsWith('/api/preferences/analysis')) {
      calls.push({ kind: 'upload', url, options });
      const result = uploadResults[uploadIndex] ?? noMatchesUpload(`analysis-${uploadIndex + 1}`);
      uploadIndex += 1;
      if (result?.__httpStatus) {
        return jsonResponse(result.body, { status: result.__httpStatus });
      }
      return jsonResponse(result);
    }

    const body = JSON.parse(options.body);
    const operationName = operationNameFor(body.query);
    calls.push({ kind: 'graphql', url, options, operationName, variables: body.variables });

    if (operationName === 'EvalIngestorMe') {
      return jsonResponse({ data: { me: { userId: backendUserId } } });
    }
    if (operationName === 'EvalIngestorResetMemory') {
      return jsonResponse({
        data: {
          resetMyMemory: {
            mode: 'MEMORY_ONLY',
            preferencesDeleted: 3,
            preferenceDefinitionsDeleted: 0,
            locationsDeleted: 0,
            preferenceAuditEventsDeleted: 0,
            mcpAccessEventsDeleted: 0,
            permissionGrantsDeleted: 0,
          },
        },
      });
    }
    if (operationName === 'EvalIngestorPreferenceSchema') {
      return jsonResponse({
        data: {
          exportPreferenceSchema: existingDefinitions.map((definition, index) =>
            typeof definition === 'string'
              ? {
                  id: `definition-${index}`,
                  slug: definition,
                  valueType: 'STRING',
                  scope: 'GLOBAL',
                  ownerUserId: null,
                  archivedAt: null,
                }
              : {
                  id: `definition-${index}`,
                  valueType: 'STRING',
                  scope: 'GLOBAL',
                  ownerUserId: null,
                  archivedAt: null,
                  ...definition,
                },
          ),
        },
      });
    }
    if (operationName === 'EvalIngestorCreateDefinition') {
      createDefinitionInputs.push(body.variables.input);
      return jsonResponse({
        data: {
          createPreferenceDefinition: {
            id: `created-${createDefinitionInputs.length}`,
            slug: body.variables.input.slug,
            valueType: body.variables.input.valueType,
            scope: body.variables.input.scope,
            ownerUserId: backendUserId,
          },
        },
      });
    }
    if (operationName === 'EvalIngestorSetPreference') {
      setPreferenceInputs.push(body.variables.input);
      return jsonResponse({
        data: {
          setPreference: {
            id: `seed-${setPreferenceInputs.length}`,
            slug: body.variables.input.slug,
            value: body.variables.input.value,
            status: 'ACTIVE',
          },
        },
      });
    }
    if (operationName === 'EvalIngestorApplySuggestions') {
      applyInputs.push(body.variables.input);
      const errorMessage = applyErrors[applyInputs.length - 1];
      if (errorMessage) {
        return jsonResponse({
          errors: [{ message: errorMessage }],
        });
      }
      const resultCount = applyResultCounts[applyInputs.length - 1] ?? body.variables.input.length;
      return jsonResponse({
        data: {
          applyPreferenceSuggestions: body.variables.input
            .slice(0, resultCount)
            .map((input, index) => ({
              id: `applied-${index + 1}`,
              slug: input.slug,
              value: input.newValue,
              status: 'ACTIVE',
            })),
        },
      });
    }
    if (operationName === 'EvalStoredPreferencesExport') {
      return jsonResponse({
        data: {
          me: { userId: backendUserId },
          activePreferences,
        },
      });
    }
    throw new Error(`Unhandled operation ${operationName}`);
  };

  return {
    fetch,
    calls,
    createDefinitionInputs,
    setPreferenceInputs,
    applyInputs,
  };
}

function operationNameFor(query) {
  return query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)?.[1] ?? '<unknown>';
}

function successUpload({
  analysisId = 'analysis-001',
  suggestions = [],
  filteredSuggestions = [],
  status = 'success',
  statusReason,
} = {}) {
  return {
    analysisId,
    suggestions,
    filteredSuggestions,
    documentSummary: 'Document summary',
    status,
    ...(statusReason ? { statusReason } : {}),
    filteredCount: filteredSuggestions.length,
  };
}

function analysisFailureUpload({ analysisId, status, statusReason }) {
  return successUpload({
    analysisId,
    status,
    statusReason,
    suggestions: [],
    filteredSuggestions: [],
  });
}

function uploadHttpError(body, status = 500) {
  return {
    __httpStatus: status,
    body,
  };
}

function noMatchesUpload(analysisId = 'analysis-empty') {
  return {
    analysisId,
    suggestions: [],
    filteredSuggestions: [],
    documentSummary: 'No preference information found',
    status: 'no_matches',
    statusReason: 'No preference-related information found in document',
    filteredCount: 0,
  };
}

function suggestion(overrides = {}) {
  return {
    id: 'analysis-001:candidate:0',
    slug: 'profile.full_name',
    operation: 'CREATE',
    oldValue: null,
    newValue: 'Alex Jordan Rivera',
    confidence: 0.93,
    sourceSnippet: 'Alex Jordan Rivera',
    sourceMeta: { page: null, line: 1 },
    wasCorrected: false,
    ...overrides,
  };
}

function pref(overrides = {}) {
  return {
    id: 'pref-1',
    userId: 'backend-user-123',
    locationId: null,
    slug: 'profile.full_name',
    definitionId: 'definition-1',
    value: 'Alex Jordan Rivera',
    status: 'ACTIVE',
    sourceType: 'INFERRED',
    confidence: 0.93,
    evidence: { source: 'test' },
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T11:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
