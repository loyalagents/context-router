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
      isSensitive: false,
      options: ['checking'],
    },
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

function createMaterializerFetchMock({ existingDefinitions = [] } = {}) {
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
