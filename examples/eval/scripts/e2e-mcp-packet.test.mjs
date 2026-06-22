import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildPacketMcpAgentPrompt,
  parseArgs,
  runMcpPacketE2E,
} from './e2e-mcp-packet.mjs';
import { loadKnownSchemaFixture } from './ingestor/setup.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-01T12:00:00.000Z');
const scenarioIds = [
  'maya-chen-newhire-i9-packet-small',
  'maya-chen-newhire-fw4-packet-small',
  'maya-chen-newhire-direct-deposit-packet-small',
];
const baseArgs = [
  '--agent',
  'command',
  '--schema-mode',
  'open',
  '--form-mode',
  'backend',
  '--user',
  'maya-chen-newhire',
  '--corpus',
  'packet-small',
  '--scenarios',
  scenarioIds.join(','),
  '--artifacts-root',
  '/tmp/mcp-packet-artifacts',
  '--mcp-server',
  'context-router-local',
  '--allow-test-command-agent',
  '--agent-command',
  'fake-agent',
];

test('mcp packet CLI parses defaults and rejects unsupported modes', () => {
  const parsed = parseArgs(baseArgs, { EVAL_AUTH_TOKEN: 'token' }, fixedNow);
  assert.equal(parsed.kind, 'ok');
  assert.deepEqual(parsed.options.scenarioIds, scenarioIds);
  assert.equal(parsed.options.documentsRoot, 'examples/eval/users/maya-chen-newhire/corpora/packet-small');
  assert.equal(parsed.options.promptTemplate, 'examples/eval/prompts/mcp-open-schema-packet.md');
  assert.match(
    parsed.options.runId,
    /^mcp-open-schema-packet-maya-chen-newhire-packet-small-2026-06-01T12-00-00-000Z$/,
  );

  const known = parseArgs(
    replaceFlagValue(baseArgs, '--schema-mode', 'known'),
    { EVAL_AUTH_TOKEN: 'token' },
    fixedNow,
  );
  assert.equal(known.kind, 'usage-error');
  assert.match(known.message, /Expected --schema-mode open/);

  const noToken = parseArgs(baseArgs, {}, fixedNow);
  assert.equal(noToken.kind, 'usage-error');
  assert.match(noToken.message, /EVAL_AUTH_TOKEN/);
});

test('mcp packet prompt describes one shared dossier for multiple forms', async () => {
  const fixture = await loadKnownSchemaFixture({
    repoRoot,
    evalUserId: 'maya-chen-newhire',
    corpusId: 'packet-small',
    documentsRoot: 'examples/eval/users/maya-chen-newhire/corpora/packet-small',
  });
  const prompt = await buildPacketMcpAgentPrompt({
    repoRoot,
    fixture,
    options: {
      userId: 'maya-chen-newhire',
      corpusId: 'packet-small',
      scenarioIds,
      documentsRoot: 'examples/eval/users/maya-chen-newhire/corpora/packet-small',
      promptTemplate: 'examples/eval/prompts/mcp-open-schema-packet.md',
      mcpServer: 'context-router-local',
    },
  });

  assert.match(prompt, /shared user dossier for multiple forms/);
  assert.match(prompt, /identity, address, tax, work authorization, employment, and direct deposit/);
  assert.match(prompt, /maya-chen-newhire-i9-packet-small/);
  assert.match(prompt, /maya-chen-newhire-fw4-packet-small/);
  assert.match(prompt, /maya-chen-newhire-direct-deposit-packet-small/);
  assert.doesNotMatch(prompt, /expectedValue/);
});

test('mcp packet run ingests once and fills every scenario from shared memory', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-packet-'));
  const fixture = await loadKnownSchemaFixture({
    repoRoot,
    evalUserId: 'maya-chen-newhire',
    corpusId: 'packet-small',
    documentsRoot: 'examples/eval/users/maya-chen-newhire/corpora/packet-small',
  });
  const calls = {
    validate: [],
    setup: 0,
    agent: 0,
    exportMemorySnapshot: 0,
    fillForm: [],
    score: [],
  };

  const result = await runMcpPacketE2E({
    repoRoot,
    args: replaceFlagValue(baseArgs, '--artifacts-root', tmp),
    env: { EVAL_AUTH_TOKEN: 'token', EVAL_MODEL_LABEL: 'test-model' },
    now: fixedNow,
    runners: {
      validate: async ({ args }) => {
        calls.validate.push(args);
        const reportOut = valueAfter(args, '--report-out');
        if (reportOut) {
          await writeFile(
            reportOut,
            jsonText({ schemaVersion: 1, summary: { errors: 0, warnings: 0 } }),
          );
        }
        return { exitCode: 0, lines: ['validation ok'] };
      },
      setupOpenSchemaMemory: async () => {
        calls.setup += 1;
        return {
          backendUserId: 'backend-maya',
          fixture,
          definitionSetup: { created: [], existing: [], skipped: [] },
        };
      },
      agent: async () => {
        calls.agent += 1;
        return {
          exitCode: 0,
          lines: ['agent ok'],
          stdout: 'EVAL_MCP_AGENT_DONE',
          stderr: '',
          timedOut: false,
          completionMarkerObserved: true,
        };
      },
      exportMemorySnapshot: async ({ args }) => {
        calls.exportMemorySnapshot += 1;
        const baselineOut = valueAfter(args, '--baseline-out');
        if (baselineOut) {
          await writeFile(
            baselineOut,
            jsonText({
              schemaVersion: 1,
              artifactType: 'definition-baseline',
              userId: 'maya-chen-newhire',
              corpusId: 'packet-small',
              scenarioId: 'packet-small-packet',
              capturedAt: fixedNow().toISOString(),
              strategy: 'baseline-only',
              backendUserId: 'backend-maya',
              definitions: [],
              definitionIds: [],
              slugs: [],
            }),
          );
        }
        const out = valueAfter(args, '--out');
        await writeFile(
          out,
          jsonText({
            schemaVersion: 1,
            artifactType: 'memory-snapshot',
            preferences: [],
            suggestions: [],
            definitions: [],
            diagnostics: { backendUserId: 'backend-maya' },
          }),
        );
        return { exitCode: 0, lines: ['export ok'] };
      },
      fillForm: async ({ args }) => {
        calls.fillForm.push(valueAfter(args, '--scenario'));
        return { exitCode: 0, lines: ['fill ok'] };
      },
      score: async ({ args }) => {
        calls.score.push(args);
        const out = valueAfter(args, '--out');
        const mode = valueAfter(args, '--mode');
        await writeFile(
          out,
          jsonText({
            schemaVersion: 1,
            scoreType: mode,
            summary: { mode },
          }),
        );
        return { exitCode: 0, lines: [`score ${mode} ok`] };
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.setup, 1);
  assert.equal(calls.agent, 1);
  assert.equal(calls.exportMemorySnapshot, 2);
  assert.equal(
    calls.validate.filter((args) => args.includes('--report-out')).length,
    1,
  );
  assert.equal(calls.validate.length, 1 + scenarioIds.length);
  assert.deepEqual(calls.fillForm, scenarioIds);
  assert.equal(
    calls.score.filter((args) => valueAfter(args, '--mode') === 'open-schema-database').length,
    1,
  );
  assert.equal(
    calls.score.filter((args) => valueAfter(args, '--mode') === 'form').length,
    scenarioIds.length,
  );
  assert.equal(
    calls.score.filter((args) => valueAfter(args, '--mode') === 'open-schema-combined').length,
    scenarioIds.length,
  );
});

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

function replaceFlagValue(args, flag, value) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  const next = [...args];
  next[index + 1] = value;
  return next;
}
