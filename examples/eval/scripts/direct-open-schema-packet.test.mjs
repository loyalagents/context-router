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
});

test('direct-open-schema-packet extracts once and fills every scenario', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'direct-open-packet-'));
  const calls = {
    extract: 0,
    fill: [],
  };

  const result = await runDirectOpenSchemaPacket({
    repoRoot,
    args: replaceFlagValue(baseArgs, '--artifacts-root', tmp),
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
  assert.equal(packet.summaries.extraction.factCount, 1);
  assert.equal(packet.qualitySummary.extractionFacts, 1);
  assert.deepEqual(Object.keys(packet.scenarios), scenarioIds);
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
