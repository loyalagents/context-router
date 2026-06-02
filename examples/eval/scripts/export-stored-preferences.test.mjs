import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, validate } from 'graphql';
import {
  parseArgs,
  runExportStoredPreferences,
} from './export-stored-preferences.mjs';
import { buildStoredPreferencesArtifact } from './exporter/mapper.mjs';
import { EXPORT_STORED_PREFERENCES_QUERY } from './exporter/query.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-01T12:00:00.000Z');

test('exporter GraphQL query validates against backend schema', async () => {
  const schemaText = await readFile(
    path.join(repoRoot, 'apps/backend/src/schema.gql'),
    'utf8',
  );
  const errors = validate(
    buildSchema(schemaText),
    parse(EXPORT_STORED_PREFERENCES_QUERY),
  );
  assert.deepEqual(
    errors.map((error) => error.message),
    [],
  );
});

test('export CLI prints help and reports invalid arguments clearly', async () => {
  const help = await runExportStoredPreferences({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:export-stored-preferences/);

  const invalid = await runExportStoredPreferences({
    repoRoot,
    args: ['--user', 'alex-i9-test'],
    env: {},
  });
  assert.equal(invalid.exitCode, 2);
  assert.match(invalid.lines.join('\n'), /Missing required --corpus/);
});

test('export CLI uses env fallback, writes schema-valid artifact, and redacts token', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        me: { userId: 'alex-i9-test' },
        activePreferences: [
          pref({ id: 'pref-2', slug: 'profile.last_name', value: 'Rivera' }),
          pref({ id: 'pref-1', slug: 'profile.full_name', value: 'Alex Jordan Rivera' }),
        ],
      },
    });
  };

  const result = await runExportStoredPreferences({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--ingestion-mode',
      'manual-ui',
      '--suggestions-were-auto-applied',
      'false',
      '--run-id',
      'run-123',
    ],
    env: {
      EVAL_GRAPHQL_URL: 'http://localhost:3000/graphql',
      EVAL_AUTH_TOKEN: 'secret-token',
    },
    fetchImpl,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:3000/graphql');
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
  const requestBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(requestBody.variables, {
    locationId: null,
    includeSuggestions: false,
  });

  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.artifactType, 'stored-preferences');
  assert.equal(artifact.runId, 'run-123');
  assert.deepEqual(artifact.storageInput.statusesScored, ['ACTIVE']);
  assert.equal(artifact.storageInput.ingestionMode, 'manual-ui');
  assert.equal(artifact.storageInput.suggestionsWereAutoApplied, false);
  assert.deepEqual(
    artifact.preferences.map((row) => row.slug),
    ['profile.full_name', 'profile.last_name'],
  );
  assert.equal(artifact.diagnostics.exportedAt, '2026-06-01T12:00:00.000Z');
  assert.equal(artifact.diagnostics.locationMode, 'global-only');
  assert.equal(JSON.stringify(artifact).includes('secret-token'), false);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);
});

test('export CLI arguments override env URL and token', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        me: { userId: 'alex-i9-test' },
        activePreferences: [],
      },
    });
  };

  const result = await runExportStoredPreferences({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--graphql-url',
      'https://hosted.example/graphql',
      '--auth-token',
      'cli-token',
      '--location-id',
      'loc-1',
    ],
    env: {
      EVAL_GRAPHQL_URL: 'http://localhost:3000/graphql',
      EVAL_AUTH_TOKEN: 'env-token',
    },
    fetchImpl,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, 'https://hosted.example/graphql');
  assert.equal(calls[0].options.headers.authorization, 'Bearer cli-token');
  assert.equal(JSON.parse(calls[0].options.body).variables.locationId, 'loc-1');

  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.diagnostics.locationMode, 'merged-location');
  assert.equal(artifact.diagnostics.locationId, 'loc-1');
});

test('export CLI defaults to localhost GraphQL URL when no URL is configured', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        me: { userId: 'alex-i9-test' },
        activePreferences: [],
      },
    });
  };

  const result = await runExportStoredPreferences({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--auth-token',
      'token',
    ],
    env: {},
    fetchImpl,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, 'http://localhost:3000/graphql');
});

test('export CLI includes suggested preferences only when requested', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');
  const fetchImpl = async () =>
    jsonResponse({
      data: {
        me: { userId: 'alex-i9-test' },
        activePreferences: [
          pref({ id: 'pref-3', slug: 'profile.last_name', value: 'Rivera' }),
        ],
        suggestedPreferences: [
          pref({
            id: 'sugg-2',
            slug: 'profile.email',
            value: 'alex@example.test',
            status: 'SUGGESTED',
          }),
          pref({
            id: 'sugg-1',
            slug: 'profile.first_name',
            value: 'Alex',
            status: 'SUGGESTED',
          }),
        ],
      },
    });

  const result = await runExportStoredPreferences({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--auth-token',
      'token',
      '--include-suggestions',
    ],
    env: {},
    fetchImpl,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.deepEqual(
    artifact.suggestions.map((row) => row.slug),
    ['profile.email', 'profile.first_name'],
  );
  assert.equal(artifact.diagnostics.suggestedPreferenceCount, 2);
});

test('export CLI fails clearly when requested suggestions are missing', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');
  const result = await runExportStoredPreferences({
    repoRoot,
    args: [...baseArgs(outPath), '--include-suggestions'],
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: {
          me: { userId: 'alex-i9-test' },
          activePreferences: [],
        },
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /suggestedPreferences response must be an array/);
});

test('exporter mapper omits suggestions when not requested', () => {
  const artifact = buildStoredPreferencesArtifact({
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    graphqlUrl: 'http://localhost:3000/graphql',
    includeSuggestions: false,
    responseData: {
      me: { userId: 'alex-i9-test' },
      activePreferences: [],
      suggestedPreferences: [
        pref({ id: 'sugg-1', status: 'SUGGESTED', slug: 'profile.email' }),
      ],
    },
    exportedAt: '2026-06-01T12:00:00.000Z',
  });
  assert.equal(Object.hasOwn(artifact, 'suggestions'), false);
  assert.equal(artifact.diagnostics.suggestedPreferenceCount, 0);
});

test('export CLI fails on authenticated user mismatch and preference row mismatch', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');

  const userMismatch = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: {
          me: { userId: 'other-user' },
          activePreferences: [],
        },
      }),
    now: fixedNow,
  });
  assert.equal(userMismatch.exitCode, 1);
  assert.match(userMismatch.lines.join('\n'), /does not match requested user/);

  const rowMismatch = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: {
          me: { userId: 'alex-i9-test' },
          activePreferences: [
            pref({ id: 'pref-1', userId: 'other-user' }),
          ],
        },
      }),
    now: fixedNow,
  });
  assert.equal(rowMismatch.exitCode, 1);
  assert.match(rowMismatch.lines.join('\n'), /does not match expected user/);
});

test('export CLI fails on HTTP errors, GraphQL errors, missing fields, and wrong status', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');

  const httpError = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({ errors: [{ message: 'Unauthorized' }] }, { status: 401 }),
    now: fixedNow,
  });
  assert.equal(httpError.exitCode, 1);
  assert.match(httpError.lines.join('\n'), /HTTP 401/);

  const graphqlError = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({ errors: [{ message: 'Field no longer exists' }] }),
    now: fixedNow,
  });
  assert.equal(graphqlError.exitCode, 1);
  assert.match(graphqlError.lines.join('\n'), /Field no longer exists/);

  const missingField = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: {
          me: { userId: 'alex-i9-test' },
          activePreferences: [
            {
              ...pref({ id: 'pref-1' }),
              slug: undefined,
            },
          ],
        },
      }),
    now: fixedNow,
  });
  assert.equal(missingField.exitCode, 1);
  assert.match(missingField.lines.join('\n'), /slug must be a non-empty string/);

  const wrongStatus = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: {
          me: { userId: 'alex-i9-test' },
          activePreferences: [
            pref({ id: 'pref-1', status: 'SUGGESTED' }),
          ],
        },
      }),
    now: fixedNow,
  });
  assert.equal(wrongStatus.exitCode, 1);
  assert.match(wrongStatus.lines.join('\n'), /does not match expected status ACTIVE/);
});

test('export CLI fails on malformed GraphQL payloads', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');

  const nonJson = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () => textResponse('not json'),
    now: fixedNow,
  });
  assert.equal(nonJson.exitCode, 1);
  assert.match(nonJson.lines.join('\n'), /not valid JSON/);

  const noData = await runExportStoredPreferences({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () => jsonResponse({}),
    now: fixedNow,
  });
  assert.equal(noData.exitCode, 1);
  assert.match(noData.lines.join('\n'), /did not include a data object/);
});

test('export CLI redacts auth token from failure output', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'export-stored-prefs-'));
  const outPath = path.join(tmp, 'stored-preferences.json');
  const result = await runExportStoredPreferences({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--auth-token',
      'failure-secret-token',
    ],
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        errors: [{ message: 'Unauthorized for failure-secret-token' }],
      }),
    now: fixedNow,
  });

  const output = result.lines.join('\n');
  assert.equal(result.exitCode, 1);
  assert.equal(output.includes('failure-secret-token'), false);
  assert.match(output, /\[redacted-auth-token\]/);
});

test('parseArgs validates boolean options', () => {
  const parsed = parseArgs(
    [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      '/tmp/out.json',
      '--suggestions-were-auto-applied',
      'yes',
    ],
    { EVAL_AUTH_TOKEN: 'token' },
  );
  assert.equal(parsed.kind, 'usage-error');
  assert.match(parsed.message, /true or false/);
});

function baseArgs(outPath) {
  return [
    '--user',
    'alex-i9-test',
    '--corpus',
    'realistic',
    '--out',
    outPath,
    '--auth-token',
    'token',
  ];
}

function pref(overrides = {}) {
  return {
    id: 'pref-1',
    userId: 'alex-i9-test',
    locationId: null,
    slug: 'profile.full_name',
    definitionId: 'definition-1',
    value: 'Alex Jordan Rivera',
    status: 'ACTIVE',
    sourceType: 'IMPORTED',
    confidence: 0.98,
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

function textResponse(text, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}
