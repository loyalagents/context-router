import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  runDirectOpenSchemaPacket,
} from './direct-open-schema-packet.mjs';

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
  assert.equal(parsed.options.maxEvidenceChars, 200000);
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
  assert.deepEqual(packet.model, { label: 'test-model', source: 'manual' });
  assert.equal(packet.thinking, null);
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

function replaceFlagValue(args, flag, value) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  const next = [...args];
  next[index + 1] = value;
  return next;
}
