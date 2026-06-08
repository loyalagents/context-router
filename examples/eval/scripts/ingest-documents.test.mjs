import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, validate } from 'graphql';
import {
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
        suggestions: [suggestion({ slug: 'profile.email', newValue: 'alex@example.test' })],
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
  assert.equal(fetchMock.createDefinitionInputs.length, 0);
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

function createFetchMock({
  backendUserId = 'backend-user-123',
  existingDefinitions = [],
  uploadResults = [],
  activePreferences = [],
  applyErrors = [],
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
          exportPreferenceSchema: existingDefinitions.map((slug, index) => ({
            id: `definition-${index}`,
            slug,
            valueType: 'STRING',
            scope: 'GLOBAL',
            ownerUserId: null,
            archivedAt: null,
          })),
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
      return jsonResponse({
        data: {
          applyPreferenceSuggestions: body.variables.input.map((input, index) => ({
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
