import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  runClaudeCodeDirectPacket,
  withClaudeCodeProvider,
} from './claude-code-direct-packet.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-22T12:00:00.000Z');
const scenarioIds = [
  'maya-chen-newhire-i9-packet-small',
  'maya-chen-newhire-fw4-packet-small',
  'maya-chen-newhire-direct-deposit-packet-small',
];

test('claude-code direct wrapper injects provider by default', () => {
  assert.deepEqual(withClaudeCodeProvider(['--user', 'maya-chen-newhire']), [
    '--provider',
    'claude-code',
    '--user',
    'maya-chen-newhire',
  ]);
  assert.deepEqual(withClaudeCodeProvider(['--provider', 'claude-code']), [
    '--provider',
    'claude-code',
  ]);
  assert.throws(
    () => withClaudeCodeProvider(['--provider', 'vertex']),
    /only supports --provider claude-code/,
  );
});

test('claude-code direct packet records model and thinking metadata', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-code-direct-packet-'));
  const result = await runClaudeCodeDirectPacket({
    repoRoot,
    args: [
      '--user',
      'maya-chen-newhire',
      '--corpus',
      'packet-small',
      '--scenarios',
      scenarioIds.join(','),
      '--artifacts-root',
      tmp,
      '--model',
      'claude-sonnet-4-20250514',
      '--thinking-mode',
      'high',
    ],
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
            evidence: [
              {
                documentId: evidenceDocuments[0].id,
                quote: 'Maya Lin Chen',
              },
            ],
          },
        ],
        unresolved: [],
      }),
    generateFillResponse: async (_prompt, { fieldMetadata }) =>
      JSON.stringify({
        fillActions: fieldMetadata.map((field) => ({
          fieldName: field.fieldName,
          action: 'SKIP',
          sourceFactIds: [],
          confidence: 0,
          skipReason: 'test skip',
        })),
      }),
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const packet = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  assert.equal(packet.agent, 'claude');
  assert.equal(packet.evaluationMode, 'direct-claude-code-open-schema-packet');
  assert.deepEqual(packet.model, {
    label: 'claude-sonnet-4-20250514',
    source: 'manual',
  });
  assert.deepEqual(packet.thinking, {
    mode: 'high',
    budget: null,
    source: 'manual',
  });
  assert.match(packet.artifacts.claudeWorkspace, /claude-direct-workspace$/);
  assert.match(packet.artifacts.extractionTranscript, /claude-extraction-transcript\.txt$/);
  const safeIndex = JSON.parse(
    await readFile(path.join(tmp, 'claude-direct-workspace', 'documents.json'), 'utf8'),
  );
  assert.equal(safeIndex.documentCount, 8);
  assert.equal(safeIndex.documents[0].path.startsWith('documents/'), true);
  const extraction = JSON.parse(await readFile(path.join(tmp, 'open-schema-extraction.json'), 'utf8'));
  assert.equal(extraction.provider, 'claude-code');
  assert.equal(extraction.evaluationMode, 'direct-claude-code-open-schema');
  const memorySnapshot = JSON.parse(
    await readFile(path.join(tmp, 'synthetic-memory-snapshot.json'), 'utf8'),
  );
  assert.equal(memorySnapshot.evaluationMode, 'direct-claude-code-open-schema');
  assert.equal(memorySnapshot.storageInput.producer, 'direct-open-schema-claude-code');
  for (const scenario of Object.values(packet.scenarios)) {
    assert.match(scenario.artifacts.fillTranscript, /claude-fill-transcript\.txt$/);
  }
});
