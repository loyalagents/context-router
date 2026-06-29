import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  runDirectOpenSchemaPacket,
} from './direct-open-schema-packet.mjs';
import { buildRunPlan } from './eval-runner/actions.mjs';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import { buildFilledFormSnapshot } from './eval-runner/snapshots.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-22T12:00:00.000Z');
const scenarioIds = [
  'maya-chen-newhire-i9-packet-small',
  'maya-chen-newhire-fw4-packet-small',
  'maya-chen-newhire-direct-deposit-packet-small',
];
const baseArgs = [
  '--user',
  'maya-chen-newhire',
  '--corpus',
  'packet-small',
  '--scenarios',
  scenarioIds.join(','),
  '--artifacts-root',
  '/tmp/direct-open-packet',
  '--model',
  'test-model',
];

test('direct-open-schema-packet CLI parses defaults', () => {
  const help = parseArgs(['--help'], {}, fixedNow);
  assert.equal(help.kind, 'help');

  const parsed = parseArgs(baseArgs, {}, fixedNow);
  assert.equal(parsed.kind, 'ok');
  assert.deepEqual(parsed.options.scenarioIds, scenarioIds);
  assert.equal(parsed.options.provider, 'vertex');
  assert.equal(parsed.options.modelSource, 'manual');
  assert.equal(parsed.options.maxEvidenceChars, 200000);
  assert.equal(parsed.options.fillMode, 'local-fact-fill');
  assert.equal(parsed.options.documentOrder, 'canonical');
  assert.equal(parsed.options.documentOrderSeed, 'packet-document-order-v1');
  assert.equal(parsed.options.thinkingMode, 'default');
  assert.equal(
    parsed.options.documentsRoot,
    'examples/eval/users/maya-chen-newhire/corpora/packet-small',
  );
  assert.equal(
    parsed.options.runId,
    'direct-open-schema-packet-maya-chen-newhire-packet-small-20260622120000',
  );

  const missing = parseArgs([], {}, fixedNow);
  assert.equal(missing.kind, 'usage-error');
  assert.match(missing.message, /Missing required --user/);

  const invalidOrder = parseArgs(
    [...baseArgs, '--document-order', 'front-loaded'],
    {},
    fixedNow,
  );
  assert.equal(invalidOrder.kind, 'usage-error');
  assert.match(invalidOrder.message, /--document-order/);

  const vertexEnvModel = parseArgs(
    removeFlagValue(baseArgs, '--model'),
    {
      EVAL_DIRECT_OPEN_SCHEMA_MODEL: 'env-direct-model',
      EVAL_CLAUDE_CODE_MODEL: 'env-claude-model',
    },
    fixedNow,
  );
  assert.equal(vertexEnvModel.kind, 'ok');
  assert.equal(vertexEnvModel.options.provider, 'vertex');
  assert.equal(vertexEnvModel.options.model, 'env-direct-model');
  assert.equal(vertexEnvModel.options.modelSource, 'env');

  const claudeEnvModel = parseArgs(
    [
      '--provider',
      'claude-code',
      ...removeFlagValue(baseArgs, '--model'),
    ],
    {
      EVAL_DIRECT_OPEN_SCHEMA_MODEL: 'env-direct-model',
      EVAL_CLAUDE_CODE_MODEL: 'env-claude-model',
    },
    fixedNow,
  );
  assert.equal(claudeEnvModel.kind, 'ok');
  assert.equal(claudeEnvModel.options.model, 'env-claude-model');
  assert.equal(claudeEnvModel.options.modelSource, 'env');

  const vertexInvalidEnvThinking = parseArgs(
    baseArgs,
    { EVAL_THINKING_MODE: 'not-a-real-mode' },
    fixedNow,
  );
  assert.equal(vertexInvalidEnvThinking.kind, 'ok');
  assert.equal(vertexInvalidEnvThinking.options.thinkingMode, 'default');
  assert.equal(vertexInvalidEnvThinking.options.thinkingSource, 'default');

  const vertexExplicitThinking = parseArgs([...baseArgs, '--thinking-mode', 'high'], {}, fixedNow);
  assert.equal(vertexExplicitThinking.kind, 'usage-error');
  assert.match(vertexExplicitThinking.message, /claude-code/);

  const backendWithoutToken = parseArgs([...baseArgs, '--fill-mode', 'backend'], {}, fixedNow);
  assert.equal(backendWithoutToken.kind, 'usage-error');
  assert.match(backendWithoutToken.message, /EVAL_AUTH_TOKEN/);
});

test('direct-open-schema-packet extracts once and fills every scenario', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-packet-'));
  const calls = {
    extract: 0,
    fill: [],
  };

  const result = await runDirectOpenSchemaPacket({
    repoRoot,
    args: [
      ...replaceFlagValue(baseArgs, '--artifacts-root', tmp),
      '--document-order',
      'relevant-last',
      '--max-evidence-chars',
      '1000000',
    ],
    env: {},
    now: fixedNow,
    generateExtractionResponse: async (_prompt, { evidenceDocuments }) => {
      calls.extract += 1;
      return JSON.stringify({
        facts: [
          {
            slug: 'profile.full_name',
            label: 'Legal name',
            valueType: 'STRING',
            value: 'Maya Lin Chen',
            confidence: 0.9,
            evidence: [
              {
                documentId: evidenceDocuments[0].id,
                quote: 'Maya Lin Chen',
              },
            ],
          },
        ],
        unresolved: [],
      });
    },
    generateFillResponse: async (_prompt, { fixture, fieldMetadata }) => {
      calls.fill.push(fixture.scenario.scenarioId);
      return JSON.stringify({
        fillActions: fieldMetadata.map((field) => ({
          fieldName: field.fieldName,
          action: 'SKIP',
          sourceFactIds: [],
          confidence: 0,
          skipReason: 'test skip',
        })),
      });
    },
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.equal(calls.extract, 1);
  assert.deepEqual(calls.fill, scenarioIds);
  await assertFile(path.join(tmp, 'open-schema-extraction.json'));
  await assertFile(path.join(tmp, 'synthetic-memory-snapshot.json'));
  await assertFile(path.join(tmp, 'open-schema-database-score-report.json'));
  await assertFile(path.join(tmp, 'packet-evaluation-run.json'));
  for (const scenarioId of scenarioIds) {
    await assertFile(path.join(tmp, 'scenarios', scenarioId, 'filled-form.json'));
    await assertFile(path.join(tmp, 'scenarios', scenarioId, 'form-score-report.json'));
    await assertFile(
      path.join(tmp, 'scenarios', scenarioId, 'open-schema-combined-score-report.json'),
    );
  }

  const packet = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  assert.equal(packet.status, 'pass');
  assert.equal(packet.agent, 'vertex');
  assert.equal(packet.evaluationMode, 'direct-vertex-open-schema-packet');
  assert.deepEqual(packet.model, { label: 'test-model', source: 'manual' });
  assert.equal(packet.thinking, null);
  assert.equal(packet.artifacts.extractionTranscript, null);
  assert.equal(packet.settings.documentOrder, 'relevant-last');
  assert.equal(packet.settings.maxEvidenceChars, 1000000);
  assert.equal(packet.documents.documentCount, 8);
  assert.equal(packet.documents.maxEvidenceChars, 1000000);
  assert.equal(packet.documents.order.mode, 'relevant-last');
  assert.deepEqual(packet.documents.order.orderedDocumentIds.slice(0, 2), [
    'maya-chen-newhire-packet-small-007',
    'maya-chen-newhire-packet-small-008',
  ]);
  assert.ok(packet.documents.evidenceCharCount > 0);
  assert.equal(packet.summaries.extraction.factCount, 1);
  assert.equal(packet.qualitySummary.extractionFacts, 1);
  assert.equal(packet.qualitySummary.memoryOwnershipClean, '0/0');
  assert.equal(packet.qualitySummary.memoryOwnershipForbiddenLeaks, 0);
  assert.deepEqual(Object.keys(packet.scenarios), scenarioIds);
  for (const scenario of Object.values(packet.scenarios)) {
    assert.equal(Object.hasOwn(scenario.artifacts, 'fillTranscript'), false);
  }
  await assertReportedArtifactsExist(packet);
});

test('direct-open-schema-packet backend fill materializes memory and skips model fill', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-packet-backend-'));
  const calls = {
    extract: 0,
    materialize: 0,
    exportMemorySnapshot: 0,
    fillForm: [],
    modelFill: 0,
  };
  let materializedSnapshot = null;

  const result = await runDirectOpenSchemaPacket({
    repoRoot,
    args: [
      ...replaceFlagValue(baseArgs, '--artifacts-root', tmp),
      '--fill-mode',
      'backend',
      '--auth-token',
      'secret-token',
      '--reset-memory',
    ],
    env: {},
    now: fixedNow,
    generateExtractionResponse: async (_prompt, { evidenceDocuments }) => {
      calls.extract += 1;
      return JSON.stringify({
        facts: [
          {
            slug: 'profile.full_name',
            label: 'Legal name',
            valueType: 'STRING',
            value: 'Maya Lin Chen',
            confidence: 0.9,
            evidence: [
              {
                documentId: evidenceDocuments[0].id,
                quote: 'Maya Lin Chen',
              },
            ],
          },
        ],
        unresolved: [],
      });
    },
    generateFillResponse: async () => {
      calls.modelFill += 1;
      throw new Error('model fill should not run in backend fill mode');
    },
    runners: {
      materializeMemory: async ({ memorySnapshot, reportOutPath, resetMemoryEnabled }) => {
        calls.materialize += 1;
        assert.equal(resetMemoryEnabled, true);
        materializedSnapshot = memorySnapshot;
        await writeFile(
          reportOutPath,
          jsonText({
            schemaVersion: 1,
            artifactType: 'synthetic-memory-materialization-report',
            status: 'pass',
            backendUserId: 'backend-maya',
            summary: {
              definitionTargetCount: 1,
              createdDefinitionCount: 1,
              existingDefinitionCount: 0,
              preferenceInputCount: 1,
              acceptedPreferenceCount: 1,
              skippedSuggestionCount: 0,
              duplicateSlugCount: 0,
            },
          }),
        );
        return {
          backendUserId: 'backend-maya',
          summary: {
            definitionTargetCount: 1,
            createdDefinitionCount: 1,
            existingDefinitionCount: 0,
            preferenceInputCount: 1,
            acceptedPreferenceCount: 1,
            skippedSuggestionCount: 0,
            duplicateSlugCount: 0,
          },
        };
      },
      exportMemorySnapshot: async ({ args }) => {
        calls.exportMemorySnapshot += 1;
        const out = valueAfter(args, '--out');
        await writeFile(out, jsonText(materializedSnapshot));
        return { exitCode: 0, lines: ['export ok'] };
      },
      fillForm: async ({ args }) => {
        const scenarioId = valueAfter(args, '--scenario');
        calls.fillForm.push(scenarioId);
        const fixture = await loadScenarioFixture({ repoRoot, scenarioId });
        const response = {
          fillId: `backend-${scenarioId}`,
          status: 'partial',
          originalFilename: path.basename(fixture.formPdfPath),
          outputFilename: `filled-${path.basename(fixture.formPdfPath)}`,
          outputMimeType: 'application/pdf',
          filledPdfBase64: Buffer.from('unit-pdf').toString('base64'),
          summary: {
            totalFields: fixture.joinedFields.length,
            filledCount: 0,
            skippedCount: fixture.joinedFields.length,
            filledFields: [],
            skippedFields: fixture.joinedFields.map(({ fieldMap }) => ({
              pdfFieldName: fieldMap.pdfFieldName,
              fieldType: 'unknown',
              skipReason: 'test skip',
            })),
            warnings: [],
          },
        };
        const snapshot = buildFilledFormSnapshot({
          fixture,
          runPlan: buildRunPlan(fixture),
          harnessResult: {
            response,
            filledPdfFields: {},
          },
        });
        await writeFile(valueAfter(args, '--response-out'), jsonText(response));
        await writeFile(valueAfter(args, '--out'), jsonText(snapshot));
        await writeFile(valueAfter(args, '--filled-pdf-out'), 'unit-pdf');
        return { exitCode: 0, lines: ['fill ok'], response, snapshot };
      },
    },
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.equal(calls.extract, 1);
  assert.equal(calls.materialize, 1);
  assert.equal(calls.exportMemorySnapshot, 1);
  assert.deepEqual(calls.fillForm, scenarioIds);
  assert.equal(calls.modelFill, 0);

  const packet = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  assert.equal(packet.status, 'pass');
  assert.equal(packet.backendUserId, 'backend-maya');
  assert.equal(packet.settings.fillMode, 'backend');
  assert.equal(packet.settings.resetMemory, true);
  assert.equal(packet.artifacts.memoryMaterializationReport.endsWith('memory-materialization-report.json'), true);
  assert.equal(
    packet.artifacts.memorySnapshotAfterMaterialization.endsWith('memory-snapshot-after-materialization.json'),
    true,
  );
  assert.equal(packet.summaries.materialization.acceptedPreferenceCount, 1);
  for (const scenario of Object.values(packet.scenarios)) {
    assert.equal(Object.hasOwn(scenario.artifacts, 'formFillResponse'), true);
    assert.equal(Object.hasOwn(scenario.artifacts, 'fillPrompt'), false);
    assert.equal(Object.hasOwn(scenario.artifacts, 'fillResponse'), false);
  }
  await assertReportedArtifactsExist(packet);
});

test('direct-open-schema-packet finalizes packet report on invalid extraction JSON', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-packet-invalid-extract-'));

  const result = await runDirectOpenSchemaPacket({
    repoRoot,
    args: replaceFlagValue(baseArgs, '--artifacts-root', tmp),
    env: {},
    now: fixedNow,
    generateExtractionResponse: async () => '{not json',
  });

  assert.equal(result.exitCode, 1);
  const packet = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  assert.equal(packet.status, 'fail');
  assert.equal(packet.endedAt, '2026-06-22T12:00:00.000Z');
  assert.equal(packet.failureStage, 'extract-open-schema-facts');
  assert.match(packet.failure.artifacts.extractionResponse, /open-schema-extraction-response\.json$/);
});

test('direct-open-schema-packet finalizes packet report on invalid local fill JSON', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-packet-invalid-fill-'));

  const result = await runDirectOpenSchemaPacket({
    repoRoot,
    args: replaceFlagValue(baseArgs, '--artifacts-root', tmp),
    env: {},
    now: fixedNow,
    generateExtractionResponse: async (_prompt, { evidenceDocuments }) =>
      JSON.stringify({
        facts: [
          {
            slug: 'profile.full_name',
            label: 'Legal name',
            valueType: 'STRING',
            value: 'Maya Lin Chen',
            confidence: 0.9,
            evidence: [{ documentId: evidenceDocuments[0].id, quote: 'Maya Lin Chen' }],
          },
        ],
        unresolved: [],
      }),
    generateFillResponse: async () => '{not json',
  });

  assert.equal(result.exitCode, 1);
  const packet = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  assert.equal(packet.status, 'fail');
  assert.equal(packet.failureStage, 'fill-form-from-extracted-facts');
  assert.equal(packet.failure.scenarioId, scenarioIds[0]);
  assert.match(packet.failure.artifacts.fillResponse, /direct-open-schema-fill-response\.json$/);
});

test('direct-open-schema-packet cap failures preserve packet document metadata', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-packet-cap-'));

  const result = await runDirectOpenSchemaPacket({
    repoRoot,
    args: [
      ...replaceFlagValue(baseArgs, '--artifacts-root', tmp),
      '--document-order',
      'relevant-last',
      '--max-evidence-chars',
      '1',
    ],
    env: {},
    now: fixedNow,
    generateExtractionResponse: async () => {
      throw new Error('extraction should not run after cap failure');
    },
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /Evidence packet exceeds 1 characters/);

  const packet = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  assert.equal(packet.status, 'fail');
  assert.equal(packet.settings.documentOrder, 'relevant-last');
  assert.equal(packet.settings.maxEvidenceChars, 1);
  assert.equal(packet.documents.documentCount, 8);
  assert.equal(packet.documents.sourceCharCount > 1, true);
  assert.equal(packet.documents.evidenceCharCount, null);
  assert.equal(packet.documents.maxEvidenceChars, 1);
  assert.equal(packet.documents.order.mode, 'relevant-last');
  assert.deepEqual(packet.documents.order.orderedDocumentIds.slice(0, 2), [
    'maya-chen-newhire-packet-small-007',
    'maya-chen-newhire-packet-small-008',
  ]);
});

async function assertFile(filePath) {
  await access(filePath);
}

async function assertReportedArtifactsExist(packet) {
  for (const artifactPath of Object.values(packet.artifacts)) {
    if (artifactPath === null) continue;
    await assertFile(path.resolve(repoRoot, artifactPath));
  }
  for (const scenario of Object.values(packet.scenarios)) {
    for (const artifactPath of Object.values(scenario.artifacts)) {
      if (artifactPath === null) continue;
      await assertFile(path.resolve(repoRoot, artifactPath));
    }
  }
}

function replaceFlagValue(args, flag, value) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  const next = [...args];
  next[index + 1] = value;
  return next;
}

function removeFlagValue(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  const next = [...args];
  next.splice(index, 2);
  return next;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}
