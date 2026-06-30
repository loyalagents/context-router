import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  definitionTargetsFromSnapshot,
  materializeSyntheticMemorySnapshot,
} from './materialize-synthetic-memory.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-24T12:00:00.000Z');

test('definitionTargetsFromSnapshot maps synthetic definitions to backend definition targets', () => {
  const targets = definitionTargetsFromSnapshot(memorySnapshot());

  assert.deepEqual(targets.map((target) => target.slug), [
    'payroll.account_type',
    'profile.full_name',
  ]);
  assert.deepEqual(
    targets.find((target) => target.slug === 'payroll.account_type'),
    {
      slug: 'payroll.account_type',
      displayName: 'Account type',
      description: 'Direct open-schema eval definition for payroll.account_type.',
      valueType: 'ENUM',
      scope: 'GLOBAL',
      isSensitive: false,
      options: ['checking'],
    },
  );
});

test('definitionTargetsFromSnapshot adds backend-fill alias targets for W-4 filing status', () => {
  const targets = definitionTargetsFromSnapshot(w4AliasSnapshot());

  assert.deepEqual(targets.map((target) => target.slug), [
    'tax.filing_status',
    'tax.w4_filing_status',
  ]);
  assert.deepEqual(
    targets.map((target) => [target.slug, target.valueType]),
    [
      ['tax.filing_status', 'STRING'],
      ['tax.w4_filing_status', 'STRING'],
    ],
  );
});

test('materializeSyntheticMemorySnapshot resets memory, creates definitions, suggests, and accepts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'materialize-synthetic-memory-'));
  const reportOutPath = path.join(tmp, 'memory-materialization-report.json');
  const fetchMock = createMaterializerFetchMock({
    existingDefinitions: [
      {
        id: 'def-existing-full-name',
        slug: 'profile.full_name',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: 'backend-user-123',
      },
    ],
  });

  const result = await materializeSyntheticMemorySnapshot({
    repoRoot,
    memorySnapshot: memorySnapshot(),
    memorySnapshotPath: path.join(tmp, 'synthetic-memory-snapshot.json'),
    reportOutPath,
    graphqlUrl: 'http://user:pass@localhost:3000/graphql?token=secret',
    authToken: 'secret-token',
    resetMemoryEnabled: true,
    resetMemoryMode: 'MEMORY_ONLY',
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.backendUserId, 'backend-user-123');
  assert.equal(result.summary.definitionTargetCount, 2);
  assert.equal(result.summary.createdDefinitionCount, 1);
  assert.equal(result.summary.existingDefinitionCount, 1);
  assert.equal(result.summary.preferenceInputCount, 3);
  assert.equal(result.summary.acceptedPreferenceCount, 3);
  assert.equal(result.summary.duplicateSlugCount, 1);

  assert.deepEqual(fetchMock.operations, [
    'EvalIngestorMe',
    'EvalIngestorResetMemory',
    'EvalIngestorPreferenceSchema',
    'EvalIngestorCreateDefinition',
    'EvalIngestorSuggestPreference',
    'EvalIngestorAcceptSuggestedPreference',
    'EvalIngestorSuggestPreference',
    'EvalIngestorAcceptSuggestedPreference',
    'EvalIngestorSuggestPreference',
    'EvalIngestorAcceptSuggestedPreference',
  ]);
  assert.deepEqual(fetchMock.createdDefinitions, [
    {
      slug: 'payroll.account_type',
      displayName: 'Account type',
      description: 'Direct open-schema eval definition for payroll.account_type.',
      valueType: 'ENUM',
      scope: 'GLOBAL',
      options: ['checking'],
      isSensitive: false,
      isCore: false,
    },
  ]);
  assert.deepEqual(fetchMock.suggestedPreferences.map((input) => input.slug), [
    'profile.full_name',
    'payroll.account_type',
    'profile.full_name',
  ]);
  assert.deepEqual(fetchMock.suggestedPreferences[0].evidence, {
    source: 'direct-open-schema-materializer',
    runId: 'run-123',
    memorySnapshot: path.relative(repoRoot, path.join(tmp, 'synthetic-memory-snapshot.json')),
    syntheticPreferenceId: 'pref-1',
    syntheticDefinitionId: 'def-1',
    extractionEvidence: { factId: 'fact-0001' },
  });

  const report = JSON.parse(await readFile(reportOutPath, 'utf8'));
  assert.equal(report.status, 'pass');
  assert.equal(report.backendUserId, 'backend-user-123');
  assert.equal(report.settings.graphqlUrl, 'http://localhost:3000/graphql?token=redacted');
  assert.deepEqual(report.preferenceMaterialization.duplicateSlugs, ['profile.full_name']);
});

test('materializeSyntheticMemorySnapshot materializes fill-compatible W-4 filing alias', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'materialize-synthetic-memory-w4-'));
  const reportOutPath = path.join(tmp, 'memory-materialization-report.json');
  const fetchMock = createMaterializerFetchMock();

  const result = await materializeSyntheticMemorySnapshot({
    repoRoot,
    memorySnapshot: w4AliasSnapshot(),
    memorySnapshotPath: path.join(tmp, 'synthetic-memory-snapshot.json'),
    reportOutPath,
    graphqlUrl: 'http://localhost:3000/graphql',
    authToken: 'secret-token',
    resetMemoryEnabled: true,
    fetchImpl: fetchMock.fetch,
    now: fixedNow,
  });

  assert.equal(result.summary.preferenceInputCount, 1);
  assert.equal(result.summary.preferenceMaterializationTargetCount, 2);
  assert.equal(result.summary.generatedAliasPreferenceCount, 1);
  assert.equal(result.summary.acceptedPreferenceCount, 2);
  assert.deepEqual(fetchMock.createdDefinitions.map((input) => input.slug), [
    'tax.filing_status',
    'tax.w4_filing_status',
  ]);
  assert.deepEqual(fetchMock.suggestedPreferences.map((input) => input.slug), [
    'tax.w4_filing_status',
    'tax.filing_status',
  ]);

  const aliasSuggestion = fetchMock.suggestedPreferences[1];
  assert.equal(aliasSuggestion.value, 'single or married filing separately');
  assert.deepEqual(aliasSuggestion.evidence.generatedAlias, {
    sourceSlug: 'tax.w4_filing_status',
    targetSlug: 'tax.filing_status',
    sourceSyntheticPreferenceId: 'pref-w4-filing-status',
  });
  assert.deepEqual(aliasSuggestion.evidence.extractionEvidence, {
    factId: 'fact-0019',
  });

  const report = JSON.parse(await readFile(reportOutPath, 'utf8'));
  assert.equal(report.status, 'pass');
  assert.deepEqual(
    report.preferenceMaterialization.accepted.map((entry) => ({
      slug: entry.slug,
      generatedAlias: entry.generatedAlias,
    })),
    [
      {
        slug: 'tax.w4_filing_status',
        generatedAlias: null,
      },
      {
        slug: 'tax.filing_status',
        generatedAlias: {
          sourceSlug: 'tax.w4_filing_status',
          targetSlug: 'tax.filing_status',
          sourceSyntheticPreferenceId: 'pref-w4-filing-status',
        },
      },
    ],
  );
});

test('materializeSyntheticMemorySnapshot surfaces GraphQL failures', async () => {
  await assert.rejects(
    materializeSyntheticMemorySnapshot({
      repoRoot,
      memorySnapshot: memorySnapshot(),
      graphqlUrl: 'http://localhost:3000/graphql',
      authToken: 'secret-token',
      fetchImpl: async () =>
        jsonResponse({
          errors: [{ message: 'schema unavailable' }],
        }),
      now: fixedNow,
    }),
    /schema unavailable/,
  );
});

test('materializeSyntheticMemorySnapshot fails early on stale existing enum options', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'materialize-synthetic-memory-enum-'));
  const reportOutPath = path.join(tmp, 'memory-materialization-report.json');
  const fetchMock = createMaterializerFetchMock({
    existingDefinitions: [
      {
        id: 'def-stale-account-type',
        slug: 'payroll.account_type',
        valueType: 'ENUM',
        scope: 'GLOBAL',
        options: ['savings'],
        ownerUserId: 'backend-user-123',
      },
    ],
  });

  await assert.rejects(
    materializeSyntheticMemorySnapshot({
      repoRoot,
      memorySnapshot: memorySnapshot(),
      reportOutPath,
      graphqlUrl: 'http://localhost:3000/graphql',
      authToken: 'secret-token',
      resetMemoryEnabled: true,
      resetMemoryMode: 'MEMORY_ONLY',
      fetchImpl: fetchMock.fetch,
      now: fixedNow,
    }),
    /payroll\.account_type is incompatible/,
  );

  assert.deepEqual(fetchMock.operations, [
    'EvalIngestorMe',
    'EvalIngestorResetMemory',
    'EvalIngestorPreferenceSchema',
  ]);

  const report = JSON.parse(await readFile(reportOutPath, 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.failure.stage, 'setup-definition');
  assert.deepEqual(report.failure.currentDefinition, {
    slug: 'payroll.account_type',
  });
  assert.equal(report.failure.details.suggestedResetMode, 'DEMO_DATA');
  assert.deepEqual(report.failure.details.mismatches, [
    {
      field: 'options',
      existing: ['savings'],
      required: ['checking'],
      missing: ['checking'],
    },
  ]);
});

test('materializeSyntheticMemorySnapshot fails early on existing definition scope mismatch', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'materialize-synthetic-memory-scope-'));
  const reportOutPath = path.join(tmp, 'memory-materialization-report.json');
  const fetchMock = createMaterializerFetchMock({
    existingDefinitions: [
      {
        id: 'def-location-full-name',
        slug: 'profile.full_name',
        valueType: 'STRING',
        scope: 'LOCATION',
        ownerUserId: 'backend-user-123',
      },
    ],
  });

  await assert.rejects(
    materializeSyntheticMemorySnapshot({
      repoRoot,
      memorySnapshot: fullNameOnlySnapshot(),
      reportOutPath,
      graphqlUrl: 'http://localhost:3000/graphql',
      authToken: 'secret-token',
      fetchImpl: fetchMock.fetch,
      now: fixedNow,
    }),
    /profile\.full_name is incompatible/,
  );

  assert.deepEqual(fetchMock.operations, [
    'EvalIngestorMe',
    'EvalIngestorPreferenceSchema',
  ]);

  const report = JSON.parse(await readFile(reportOutPath, 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.failure.stage, 'setup-definition');
  assert.deepEqual(report.failure.details.mismatches, [
    {
      field: 'scope',
      existing: 'LOCATION',
      required: 'GLOBAL',
    },
  ]);
});

test('materializeSyntheticMemorySnapshot writes a failure report when suggest fails', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'materialize-synthetic-memory-suggest-'));
  const reportOutPath = path.join(tmp, 'memory-materialization-report.json');
  const fetchMock = createMaterializerFetchMock({
    existingDefinitions: [
      {
        id: 'def-existing-full-name',
        slug: 'profile.full_name',
        valueType: 'STRING',
        scope: 'GLOBAL',
        ownerUserId: 'backend-user-123',
      },
      {
        id: 'def-existing-account-type',
        slug: 'payroll.account_type',
        valueType: 'ENUM',
        scope: 'GLOBAL',
        options: ['checking'],
        ownerUserId: 'backend-user-123',
      },
    ],
    failOperation: 'EvalIngestorSuggestPreference',
    failMessage: 'suggest denied',
  });

  await assert.rejects(
    materializeSyntheticMemorySnapshot({
      repoRoot,
      memorySnapshot: memorySnapshot(),
      reportOutPath,
      graphqlUrl: 'http://localhost:3000/graphql',
      authToken: 'secret-token',
      fetchImpl: fetchMock.fetch,
      now: fixedNow,
    }),
    /suggest denied/,
  );

  const report = JSON.parse(await readFile(reportOutPath, 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.failure.stage, 'suggest-preference');
  assert.deepEqual(report.failure.currentPreference, {
    index: 0,
    slug: 'profile.full_name',
    syntheticPreferenceId: 'pref-1',
  });
  assert.equal(report.failure.error.name, 'Error');
  assert.match(report.failure.error.message, /suggest denied/);
  assert.equal(report.summary.acceptedPreferenceCount, 0);
});

function memorySnapshot() {
  return {
    schemaVersion: 1,
    artifactType: 'memory-snapshot',
    runId: 'run-123',
    userId: 'maya-chen-newhire',
    corpusId: 'packet-small',
    definitions: [
      {
        id: 'def-1',
        slug: 'profile.full_name',
        displayName: 'Full name',
        description: '',
        valueType: 'STRING',
        isSensitive: false,
      },
      {
        id: 'def-2',
        slug: 'payroll.account_type',
        displayName: 'Account type',
        description: '',
        valueType: 'ENUM',
        options: null,
        isSensitive: false,
      },
    ],
    preferences: [
      {
        id: 'pref-1',
        slug: 'profile.full_name',
        definitionId: 'def-1',
        value: 'Maya Lin Chen',
        confidence: 0.9,
        evidence: { factId: 'fact-0001' },
      },
      {
        id: 'pref-2',
        slug: 'payroll.account_type',
        definitionId: 'def-2',
        value: 'checking',
        confidence: 0.8,
        evidence: { factId: 'fact-0002' },
      },
      {
        id: 'pref-3',
        slug: 'profile.full_name',
        definitionId: 'def-1',
        value: 'Maya L. Chen',
        confidence: 0.7,
        evidence: { factId: 'fact-0003' },
      },
    ],
  };
}

function fullNameOnlySnapshot() {
  const snapshot = memorySnapshot();
  return {
    ...snapshot,
    definitions: snapshot.definitions.filter(
      (definition) => definition.slug === 'profile.full_name',
    ),
    preferences: snapshot.preferences.filter(
      (preference) => preference.slug === 'profile.full_name',
    ),
  };
}

function w4AliasSnapshot() {
  return {
    schemaVersion: 1,
    artifactType: 'memory-snapshot',
    runId: 'run-w4',
    userId: 'maya-chen-newhire',
    corpusId: 'packet-small',
    definitions: [
      {
        id: 'def-w4-filing-status',
        slug: 'tax.w4_filing_status',
        displayName: 'W-4 Filing Status',
        description: '',
        valueType: 'STRING',
        isSensitive: false,
      },
    ],
    preferences: [
      {
        id: 'pref-w4-filing-status',
        slug: 'tax.w4_filing_status',
        definitionId: 'def-w4-filing-status',
        value: 'single or married filing separately',
        confidence: 0.97,
        evidence: { factId: 'fact-0019' },
      },
    ],
  };
}

function createMaterializerFetchMock({
  existingDefinitions = [],
  failOperation = null,
  failMessage = 'forced GraphQL failure',
} = {}) {
  const operations = [];
  const createdDefinitions = [];
  const suggestedPreferences = [];
  const suggestions = new Map();
  let suggestionCounter = 0;

  return {
    operations,
    createdDefinitions,
    suggestedPreferences,
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body);
      const operation = operationName(body.query);
      operations.push(operation);
      if (operation === failOperation) {
        return jsonResponse({
          errors: [{ message: failMessage }],
        });
      }
      if (operation === 'EvalIngestorMe') {
        return jsonResponse({ data: { me: { userId: 'backend-user-123' } } });
      }
      if (operation === 'EvalIngestorResetMemory') {
        return jsonResponse({
          data: {
            resetMyMemory: {
              mode: body.variables.mode,
              preferencesDeleted: 0,
              preferenceDefinitionsDeleted: 0,
              locationsDeleted: 0,
              preferenceAuditEventsDeleted: 0,
              mcpAccessEventsDeleted: 0,
              permissionGrantsDeleted: 0,
            },
          },
        });
      }
      if (operation === 'EvalIngestorPreferenceSchema') {
        return jsonResponse({ data: { exportPreferenceSchema: existingDefinitions } });
      }
      if (operation === 'EvalIngestorCreateDefinition') {
        createdDefinitions.push(body.variables.input);
        return jsonResponse({
          data: {
            createPreferenceDefinition: {
              id: `def-created-${createdDefinitions.length}`,
              ...body.variables.input,
              ownerUserId: 'backend-user-123',
            },
          },
        });
      }
      if (operation === 'EvalIngestorSuggestPreference') {
        suggestedPreferences.push(body.variables.input);
        suggestionCounter += 1;
        const suggestion = {
          id: `suggestion-${suggestionCounter}`,
          slug: body.variables.input.slug,
          value: body.variables.input.value,
          status: 'SUGGESTED',
          confidence: body.variables.input.confidence,
          evidence: body.variables.input.evidence,
        };
        suggestions.set(suggestion.id, suggestion);
        return jsonResponse({ data: { suggestPreference: suggestion } });
      }
      if (operation === 'EvalIngestorAcceptSuggestedPreference') {
        const suggestion = suggestions.get(body.variables.id);
        return jsonResponse({
          data: {
            acceptSuggestedPreference: {
              ...suggestion,
              id: `active-${body.variables.id}`,
              status: 'ACTIVE',
            },
          },
        });
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  };
}

function operationName(query) {
  const match = String(query).match(/\b(?:query|mutation)\s+(\w+)/);
  return match?.[1] ?? '<unknown>';
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
