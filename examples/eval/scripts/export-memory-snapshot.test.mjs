import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, validate } from 'graphql';
import {
  parseArgs,
  runExportMemorySnapshot,
} from './export-memory-snapshot.mjs';
import {
  buildMemorySnapshotArtifact,
  sortDefinitionRows,
} from './memory-snapshot/mapper.mjs';
import { EXPORT_MEMORY_SNAPSHOT_QUERY } from './memory-snapshot/query.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-01T12:00:00.000Z');

test('memory snapshot GraphQL query validates against backend schema', async () => {
  const schemaText = await readFile(
    path.join(repoRoot, 'apps/backend/src/schema.gql'),
    'utf8',
  );
  const errors = validate(
    buildSchema(schemaText),
    parse(EXPORT_MEMORY_SNAPSHOT_QUERY),
  );
  assert.deepEqual(
    errors.map((error) => error.message),
    [],
  );
});

test('memory snapshot CLI prints help and reports invalid args clearly', async () => {
  const help = await runExportMemorySnapshot({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:export-memory-snapshot/);

  const invalid = await runExportMemorySnapshot({
    repoRoot,
    args: ['--user', 'alex-i9-test'],
    env: {},
  });
  assert.equal(invalid.exitCode, 2);
  assert.match(invalid.lines.join('\n'), /Missing required --corpus/);
});

test('memory snapshot CLI uses env fallback, writes schema-valid artifact, and redacts token', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: snapshotResponse({
        activePreferences: [
          pref({ id: 'pref-2', slug: 'profile.last_name', value: 'Rivera' }),
          pref({ id: 'pref-1', slug: 'profile.full_name', value: 'Alex Jordan Rivera' }),
        ],
        definitions: [
          definition({ id: 'def-2', slug: 'profile.last_name' }),
          definition({ id: 'def-1', slug: 'profile.full_name' }),
          definition({ id: 'def-3', slug: 'profile.nickname' }),
        ],
      }),
    });
  };

  const result = await runExportMemorySnapshot({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--scenario',
      'alex-i9-realistic',
      '--out',
      outPath,
      '--producer',
      'mcp-agent',
      '--schema-reset-mode',
      'baseline-only',
      '--run-id',
      'run-123',
    ],
    env: {
      EVAL_GRAPHQL_URL: 'http://user:pass@localhost:3000/graphql?token=query-secret&keep=1',
      EVAL_AUTH_TOKEN: 'secret-token',
    },
    fetchImpl,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://user:pass@localhost:3000/graphql?token=query-secret&keep=1');
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(calls[0].options.body).variables, {
    locationId: null,
    includeSuggestions: false,
  });

  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.artifactType, 'memory-snapshot');
  assert.equal(artifact.runId, 'run-123');
  assert.equal(artifact.evaluationMode, 'mcp-open-schema');
  assert.equal(artifact.scenarioId, 'alex-i9-realistic');
  assert.deepEqual(artifact.storageInput.statusesScored, ['ACTIVE']);
  assert.equal(artifact.storageInput.schemaMode, 'open');
  assert.equal(artifact.storageInput.producer, 'mcp-agent');
  assert.equal(artifact.storageInput.suggestionsWereAutoApplied, false);
  assert.deepEqual(
    artifact.preferences.map((row) => row.slug),
    ['profile.full_name', 'profile.last_name'],
  );
  assert.deepEqual(
    artifact.definitions.map((row) => row.slug),
    ['profile.full_name', 'profile.last_name', 'profile.nickname'],
  );
  assert.equal(artifact.definitionBaseline.capturedBeforeRun, false);
  assert.equal(artifact.definitionBaseline.strategy, 'baseline-only');
  assert.equal(artifact.diagnostics.graphqlUrl, 'http://localhost:3000/graphql?token=redacted&keep=1');
  assert.equal(artifact.diagnostics.locationMode, 'global-only');
  assert.equal(artifact.diagnostics.preferencesMergedWithLocation, false);
  assert.equal(artifact.diagnostics.backendUserId, 'alex-i9-test');
  assert.equal(JSON.stringify(artifact).includes('secret-token'), false);
  assert.equal(JSON.stringify(artifact).includes('query-secret'), false);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);
  assert.equal(result.lines.join('\n').includes('query-secret'), false);
});

test('memory snapshot CLI arguments override env and record merged-location diagnostics', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const calls = [];
  const result = await runExportMemorySnapshot({
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
      '--schema-mode',
      'known',
      '--producer',
      'manual',
    ],
    env: {
      EVAL_GRAPHQL_URL: 'http://localhost:3000/graphql',
      EVAL_AUTH_TOKEN: 'env-token',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ data: snapshotResponse() });
    },
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, 'https://hosted.example/graphql');
  assert.equal(calls[0].options.headers.authorization, 'Bearer cli-token');
  assert.equal(JSON.parse(calls[0].options.body).variables.locationId, 'loc-1');

  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.evaluationMode, 'known-schema');
  assert.equal(artifact.diagnostics.locationMode, 'merged-location');
  assert.equal(artifact.diagnostics.locationId, 'loc-1');
  assert.equal(artifact.diagnostics.preferencesMergedWithLocation, true);
});

test('memory snapshot CLI defaults to localhost GraphQL URL and generated run id', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const calls = [];
  const result = await runExportMemorySnapshot({
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
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ data: snapshotResponse() });
    },
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, 'http://localhost:3000/graphql');
  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(
    artifact.runId,
    'memory-snapshot-open-alex-i9-test-realistic-2026-06-01T12-00-00-000Z',
  );
});

test('memory snapshot includes suggestions only when requested', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const response = snapshotResponse({
    suggestedPreferences: [
      pref({ id: 'sugg-2', slug: 'profile.email', status: 'SUGGESTED' }),
      pref({ id: 'sugg-1', slug: 'profile.first_name', status: 'SUGGESTED' }),
    ],
  });

  const withoutSuggestions = buildMemorySnapshotArtifact({
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    graphqlUrl: 'http://localhost:3000/graphql',
    includeSuggestions: false,
    producer: 'manual-or-export',
    schemaMode: 'open',
    schemaResetMode: 'none',
    runId: 'run-1',
    responseData: response,
    exportedAt: '2026-06-01T12:00:00.000Z',
  });
  assert.equal(Object.hasOwn(withoutSuggestions, 'suggestions'), false);

  const result = await runExportMemorySnapshot({
    repoRoot,
    args: [
      ...baseArgs(outPath),
      '--include-suggestions',
    ],
    env: {},
    fetchImpl: async () => jsonResponse({ data: response }),
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

test('memory snapshot sorts definitions deterministically', () => {
  const rows = [
    definition({ id: 'id-3', slug: 'profile.full_name', namespace: 'USER:u' }),
    definition({ id: 'id-2', slug: 'profile.full_name', namespace: 'GLOBAL' }),
    definition({ id: 'id-1', slug: 'profile.email', namespace: 'GLOBAL' }),
  ];
  assert.deepEqual(
    sortDefinitionRows(rows).map((row) => [row.slug, row.namespace, row.id]),
    [
      ['profile.email', 'GLOBAL', 'id-1'],
      ['profile.full_name', 'GLOBAL', 'id-2'],
      ['profile.full_name', 'USER:u', 'id-3'],
    ],
  );
});

test('memory snapshot preserves backend-valid empty definition descriptions and structured JSON', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const result = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          activePreferences: [
            pref({
              id: 'pref-1',
              value: ['email', 'sms'],
              evidence: { sources: ['profile'], confidenceNote: 'user-owned' },
            }),
          ],
          definitions: [
            definition({
              id: 'definition-1',
              description: '',
              valueType: 'ENUM',
              options: ['email', 'sms'],
            }),
          ],
        }),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.definitions[0].description, '');
  assert.deepEqual(artifact.definitions[0].options, ['email', 'sms']);
  assert.deepEqual(artifact.preferences[0].value, ['email', 'sms']);
  assert.deepEqual(artifact.preferences[0].evidence.sources, ['profile']);
});

test('memory snapshot baseline-out writes pre-run definition ids and slugs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const baselinePath = path.join(tmp, 'definition-baseline.json');

  const result = await runExportMemorySnapshot({
    repoRoot,
    args: [
      ...baseArgs(outPath),
      '--baseline-out',
      baselinePath,
      '--schema-reset-mode',
      'baseline-only',
    ],
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          definitions: [
            definition({ id: 'def-2', slug: 'profile.last_name' }),
            definition({ id: 'def-1', slug: 'profile.full_name' }),
          ],
        }),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  assert.equal(baseline.artifactType, 'definition-baseline');
  assert.deepEqual(baseline.definitionIds, ['def-1', 'def-2']);
  assert.deepEqual(baseline.slugs, ['profile.full_name', 'profile.last_name']);

  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.definitionBaseline.capturedBeforeRun, true);
  assert.deepEqual(artifact.definitionBaseline.preexistingDefinitionIds, ['def-1', 'def-2']);
  assert.deepEqual(artifact.definitionBaseline.newDefinitionIds, []);
});

test('memory snapshot baseline-in identifies new definition ids and slugs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const baselinePath = path.join(tmp, 'definition-baseline.json');
  await writeFile(
    baselinePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        artifactType: 'definition-baseline',
        userId: 'alex-i9-test',
        corpusId: 'realistic',
        backendUserId: 'backend-user-123',
        capturedAt: '2026-06-01T11:00:00.000Z',
        strategy: 'baseline-only',
        definitionIds: ['def-1', 'def-removed'],
        slugs: ['profile.full_name', 'profile.removed'],
      },
      null,
      2,
    ),
  );

  const result = await runExportMemorySnapshot({
    repoRoot,
    args: [
      ...baseArgs(outPath),
      '--baseline-in',
      baselinePath,
    ],
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          backendUserId: 'backend-user-123',
          activePreferences: [
            pref({ id: 'pref-1', userId: 'backend-user-123' }),
          ],
          definitions: [
            definition({ id: 'def-1', slug: 'profile.full_name' }),
            definition({ id: 'def-2', slug: 'profile.last_name' }),
            definition({
              id: 'def-3',
              namespace: 'USER:backend-user-123',
              slug: 'profile.last_name',
            }),
          ],
        }),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.definitionBaseline.capturedBeforeRun, true);
  assert.deepEqual(artifact.definitionBaseline.preexistingDefinitionIds, ['def-1', 'def-removed']);
  assert.deepEqual(artifact.definitionBaseline.newDefinitionIds, ['def-2', 'def-3']);
  assert.deepEqual(artifact.definitionBaseline.newSlugs, ['profile.last_name']);
  assert.deepEqual(artifact.definitionBaseline.removedDefinitionIds, ['def-removed']);
  assert.deepEqual(artifact.definitionBaseline.removedSlugs, ['profile.removed']);
});

test('memory snapshot records eval user separately from authenticated backend user', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const result = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          backendUserId: 'backend-user-123',
          activePreferences: [
            pref({ id: 'pref-1', userId: 'backend-user-123' }),
          ],
        }),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0);
  const artifact = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(artifact.userId, 'alex-i9-test');
  assert.equal(artifact.preferences[0].userId, 'backend-user-123');
  assert.equal(artifact.diagnostics.backendUserId, 'backend-user-123');
});

test('memory snapshot CLI fails when preference rows do not belong to authenticated backend user', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const result = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          activePreferences: [
            pref({ id: 'pref-1', userId: 'other-user' }),
          ],
        }),
      }),
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /does not match expected user/);
});

test('memory snapshot CLI fails on HTTP errors, GraphQL errors, missing fields, and wrong status', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');

  const httpError = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({ errors: [{ message: 'Unauthorized' }] }, { status: 401 }),
    now: fixedNow,
  });
  assert.equal(httpError.exitCode, 1);
  assert.match(httpError.lines.join('\n'), /HTTP 401/);

  const graphqlError = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({ errors: [{ message: 'Field no longer exists' }] }),
    now: fixedNow,
  });
  assert.equal(graphqlError.exitCode, 1);
  assert.match(graphqlError.lines.join('\n'), /Field no longer exists/);

  const missingPreferenceField = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          activePreferences: [
            {
              ...pref({ id: 'pref-1' }),
              slug: undefined,
            },
          ],
        }),
      }),
    now: fixedNow,
  });
  assert.equal(missingPreferenceField.exitCode, 1);
  assert.match(missingPreferenceField.lines.join('\n'), /slug must be a non-empty string/);

  const wrongStatus = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          activePreferences: [
            pref({ id: 'pref-1', status: 'SUGGESTED' }),
          ],
        }),
      }),
    now: fixedNow,
  });
  assert.equal(wrongStatus.exitCode, 1);
  assert.match(wrongStatus.lines.join('\n'), /does not match expected status ACTIVE/);

  const missingDefinitionField = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () =>
      jsonResponse({
        data: snapshotResponse({
          definitions: [
            {
              ...definition({ id: 'def-1' }),
              valueType: undefined,
            },
          ],
        }),
      }),
    now: fixedNow,
  });
  assert.equal(missingDefinitionField.exitCode, 1);
  assert.match(missingDefinitionField.lines.join('\n'), /valueType must be a non-empty string/);
});

test('memory snapshot CLI fails on malformed GraphQL payloads and baseline mismatches', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');

  const nonJson = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () => textResponse('not json'),
    now: fixedNow,
  });
  assert.equal(nonJson.exitCode, 1);
  assert.match(nonJson.lines.join('\n'), /not valid JSON/);

  const noData = await runExportMemorySnapshot({
    repoRoot,
    args: baseArgs(outPath),
    env: {},
    fetchImpl: async () => jsonResponse({}),
    now: fixedNow,
  });
  assert.equal(noData.exitCode, 1);
  assert.match(noData.lines.join('\n'), /did not include a data object/);

  const baselinePath = path.join(tmp, 'bad-baseline.json');
  await writeFile(
    baselinePath,
    JSON.stringify({
      artifactType: 'definition-baseline',
      userId: 'different-user',
      corpusId: 'realistic',
      definitionIds: [],
      slugs: [],
    }),
  );
  const mismatch = await runExportMemorySnapshot({
    repoRoot,
    args: [
      ...baseArgs(outPath),
      '--baseline-in',
      baselinePath,
    ],
    env: {},
    fetchImpl: async () => jsonResponse({ data: snapshotResponse() }),
    now: fixedNow,
  });
  assert.equal(mismatch.exitCode, 1);
  assert.match(mismatch.lines.join('\n'), /does not match alex-i9-test/);
});

test('memory snapshot CLI redacts auth token from failure output and validates parse options', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'memory-snapshot-'));
  const outPath = path.join(tmp, 'memory-snapshot.json');
  const result = await runExportMemorySnapshot({
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

  const credentialUrl = 'http://user:pass@localhost:3000/graphql?token=query-secret&keep=1';
  const urlFailure = await runExportMemorySnapshot({
    repoRoot,
    args: [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--graphql-url',
      credentialUrl,
      '--auth-token',
      'failure-secret-token',
    ],
    env: {},
    fetchImpl: async () => {
      throw new Error(
        `Request cannot be constructed from URL ${credentialUrl} with failure-secret-token`,
      );
    },
    now: fixedNow,
  });
  const urlFailureOutput = urlFailure.lines.join('\n');
  assert.equal(urlFailure.exitCode, 1);
  assert.equal(urlFailureOutput.includes('failure-secret-token'), false);
  assert.equal(urlFailureOutput.includes('user:pass'), false);
  assert.equal(urlFailureOutput.includes('query-secret'), false);
  assert.match(urlFailureOutput, /http:\/\/localhost:3000\/graphql\?token=redacted&keep=1/);

  const badMode = parseArgs(
    [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--schema-mode',
      'closed',
    ],
    { EVAL_AUTH_TOKEN: 'token' },
  );
  assert.equal(badMode.kind, 'usage-error');
  assert.match(badMode.message, /schema-mode/);

  const badResetMode = parseArgs(
    [
      '--user',
      'alex-i9-test',
      '--corpus',
      'realistic',
      '--out',
      outPath,
      '--schema-reset-mode',
      'drop-all',
    ],
    { EVAL_AUTH_TOKEN: 'token' },
  );
  assert.equal(badResetMode.kind, 'usage-error');
  assert.match(badResetMode.message, /schema-reset-mode/);

  const bothBaselines = parseArgs(
    [
      ...baseArgs(outPath),
      '--baseline-in',
      '/tmp/in.json',
      '--baseline-out',
      '/tmp/out.json',
    ],
    {},
  );
  assert.equal(bothBaselines.kind, 'usage-error');
  assert.match(bothBaselines.message, /only one/);
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

function snapshotResponse({
  backendUserId = 'alex-i9-test',
  activePreferences = [pref()],
  suggestedPreferences = [],
  definitions = [definition()],
} = {}) {
  return {
    me: { userId: backendUserId },
    activePreferences,
    suggestedPreferences,
    exportPreferenceSchema: definitions,
  };
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

function definition(overrides = {}) {
  const slug = overrides.slug ?? 'profile.full_name';
  return {
    id: 'definition-1',
    namespace: 'GLOBAL',
    slug,
    displayName: 'Full Name',
    ownerUserId: null,
    archivedAt: null,
    description: 'User full legal name.',
    valueType: 'STRING',
    scope: 'GLOBAL',
    options: null,
    isSensitive: false,
    isCore: false,
    category: slug.split('.')[0],
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
