import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
const volumeV2ScenarioIds = [
  'maya-chen-newhire-i9-packet-hard-volume-v2',
  'maya-chen-newhire-fw4-packet-hard-volume-v2',
  'maya-chen-newhire-direct-deposit-packet-hard-volume-v2',
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
const volumeV2BaseArgs = [
  '--agent',
  'command',
  '--schema-mode',
  'open',
  '--form-mode',
  'backend',
  '--user',
  'maya-chen-newhire',
  '--corpus',
  'packet-hard-volume-v2',
  '--scenarios',
  volumeV2ScenarioIds.join(','),
  '--artifacts-root',
  '/tmp/mcp-packet-v2-artifacts',
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
  assert.equal(parsed.options.documentOrder, 'canonical');
  assert.equal(parsed.options.documentOrderSeed, 'packet-document-order-v1');
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

  const invalidOrder = parseArgs(
    [...baseArgs, '--document-order', 'front-loaded'],
    { EVAL_AUTH_TOKEN: 'token' },
    fixedNow,
  );
  assert.equal(invalidOrder.kind, 'usage-error');
  assert.match(invalidOrder.message, /--document-order/);
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
      documentOrder: 'reverse',
    },
  });

  assert.match(prompt, /shared user dossier for multiple forms/);
  assert.match(prompt, /identity, address, tax, work authorization, employment, and direct deposit/);
  assert.match(prompt, /maya-chen-newhire-i9-packet-small/);
  assert.match(prompt, /maya-chen-newhire-fw4-packet-small/);
  assert.match(prompt, /maya-chen-newhire-direct-deposit-packet-small/);
  assert.ok(
    prompt.indexOf('maya-chen-newhire-packet-small-008') <
      prompt.indexOf('maya-chen-newhire-packet-small-001'),
  );
  assert.doesNotMatch(prompt, /expectedValue/);
});

test('mcp packet supports packet-hard-volume-v2 prompt and run wiring', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-packet-v2-'));
  const documentsRoot =
    'examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v2';
  const fixture = await loadKnownSchemaFixture({
    repoRoot,
    evalUserId: 'maya-chen-newhire',
    corpusId: 'packet-hard-volume-v2',
    documentsRoot,
  });
  const prompt = await buildPacketMcpAgentPrompt({
    repoRoot,
    fixture,
    options: {
      userId: 'maya-chen-newhire',
      corpusId: 'packet-hard-volume-v2',
      scenarioIds: volumeV2ScenarioIds,
      documentsRoot,
      promptTemplate: 'examples/eval/prompts/mcp-open-schema-packet.md',
      mcpServer: 'context-router-local',
      documentOrder: 'relevant-last',
    },
  });

  assert.match(prompt, /maya-chen-newhire-i9-packet-hard-volume-v2/);
  assert.match(prompt, /maya-chen-newhire-fw4-packet-hard-volume-v2/);
  assert.match(prompt, /maya-chen-newhire-direct-deposit-packet-hard-volume-v2/);
  assert.match(prompt, /maya-chen-newhire-packet-hard-volume-v2-100/);

  const calls = {
    fillForm: [],
    agentPromptIncludesV2: false,
  };
  const formSummaries = {
    'maya-chen-newhire-i9-packet-hard-volume-v2': {
      knownFieldTotal: 12,
      knownFieldCorrect: 12,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 2,
      abstentionFieldAbsentCorrect: 2,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
    'maya-chen-newhire-fw4-packet-hard-volume-v2': {
      knownFieldTotal: 6,
      knownFieldCorrect: 6,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 0,
      abstentionFieldAbsentCorrect: 0,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
    'maya-chen-newhire-direct-deposit-packet-hard-volume-v2': {
      knownFieldTotal: 9,
      knownFieldCorrect: 9,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 1,
      abstentionFieldAbsentCorrect: 1,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
  };

  const result = await runMcpPacketE2E({
    repoRoot,
    args: [
      ...replaceFlagValue(volumeV2BaseArgs, '--artifacts-root', tmp),
      '--document-order',
      'relevant-last',
    ],
    env: { EVAL_AUTH_TOKEN: 'token', EVAL_MODEL_LABEL: 'test-model' },
    now: fixedNow,
    runners: {
      validate: async ({ args }) => {
        const reportOut = valueAfter(args, '--report-out');
        if (reportOut) {
          await writeFile(
            reportOut,
            jsonText({ schemaVersion: 1, summary: { errors: 0, warnings: 0 } }),
          );
        }
        return { exitCode: 0, lines: ['validation ok'] };
      },
      setupOpenSchemaMemory: async () => ({
        backendUserId: 'backend-maya',
        fixture,
        definitionSetup: { created: [], existing: [], skipped: [] },
      }),
      agent: async ({ prompt }) => {
        calls.agentPromptIncludesV2 = prompt.includes(
          'maya-chen-newhire-packet-hard-volume-v2-100',
        );
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
        const baselineOut = valueAfter(args, '--baseline-out');
        if (baselineOut) {
          await writeFile(
            baselineOut,
            jsonText({
              schemaVersion: 1,
              artifactType: 'definition-baseline',
              userId: 'maya-chen-newhire',
              corpusId: 'packet-hard-volume-v2',
              scenarioId: 'packet-hard-volume-v2-packet',
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
        const out = valueAfter(args, '--out');
        const mode = valueAfter(args, '--mode');
        const scenarioId = valueAfter(args, '--scenario');
        const summary = mode === 'open-schema-database'
          ? {
              knownPresentTotal: 24,
              knownPresentRecoveredActive: 24,
              knownPresentValuePresentActive: 24,
              knownPresentPresentAsCompositeOrAlias: 0,
              knownPresentGenuinelyMissing: 0,
              activeValueRecoveryRate: 1,
              activeValuePresenceRate: 1,
              intentionallyMissingTotal: 2,
              missingAbsentCorrect: 2,
              ownershipDecoyTotal: 0,
              ownershipDecoyClean: 0,
              ownershipDecoyAllowedScoped: 0,
              ownershipDecoyForbiddenActiveLeak: 0,
              ownershipDecoyForbiddenSuggestionLeak: 0,
            }
          : mode === 'form'
            ? formSummaries[scenarioId]
            : { mode };
        await writeFile(
          out,
          jsonText({
            schemaVersion: 1,
            scoreType: mode,
            summary,
          }),
        );
        return { exitCode: 0, lines: [`score ${mode} ok`] };
      },
    },
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.deepEqual(calls.fillForm, volumeV2ScenarioIds);
  assert.equal(calls.agentPromptIncludesV2, true);

  const report = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  const safeIndex = JSON.parse(
    await readFile(path.join(tmp, 'agent-workspace', 'documents.json'), 'utf8'),
  );
  assert.equal(report.corpusId, 'packet-hard-volume-v2');
  assert.equal(report.documents.documentCount, 100);
  assert.equal(report.documents.sourceCharCount > 200000, true);
  assert.equal(report.documents.order.mode, 'relevant-last');
  assert.equal(safeIndex.documents.length, 100);
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
  const formSummaries = {
    'maya-chen-newhire-i9-packet-small': {
      knownFieldTotal: 12,
      knownFieldCorrect: 12,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 2,
      abstentionFieldAbsentCorrect: 2,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
    'maya-chen-newhire-fw4-packet-small': {
      knownFieldTotal: 6,
      knownFieldCorrect: 6,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 0,
      abstentionFieldAbsentCorrect: 0,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
    'maya-chen-newhire-direct-deposit-packet-small': {
      knownFieldTotal: 9,
      knownFieldCorrect: 9,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 1,
      abstentionFieldAbsentCorrect: 1,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
  };

  const result = await runMcpPacketE2E({
    repoRoot,
    args: [
      ...replaceFlagValue(baseArgs, '--artifacts-root', tmp),
      '--document-order',
      'relevant-last',
    ],
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
        const scenarioId = valueAfter(args, '--scenario');
        const summary = mode === 'open-schema-database'
          ? {
              knownPresentTotal: 24,
              knownPresentRecoveredActive: 24,
              knownPresentValuePresentActive: 24,
              knownPresentPresentAsCompositeOrAlias: 0,
              knownPresentGenuinelyMissing: 0,
              activeValueRecoveryRate: 1,
              activeValuePresenceRate: 1,
              intentionallyMissingTotal: 2,
              missingAbsentCorrect: 2,
              ownershipDecoyTotal: 0,
              ownershipDecoyClean: 0,
              ownershipDecoyAllowedScoped: 0,
              ownershipDecoyForbiddenActiveLeak: 0,
              ownershipDecoyForbiddenSuggestionLeak: 0,
            }
          : mode === 'form'
            ? formSummaries[scenarioId]
            : { mode };
        await writeFile(
          out,
          jsonText({
            schemaVersion: 1,
            scoreType: mode,
            summary,
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
  const report = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  const safeIndex = JSON.parse(
    await readFile(path.join(tmp, 'agent-workspace', 'documents.json'), 'utf8'),
  );
  assert.equal(report.settings.documentOrder, 'relevant-last');
  assert.equal(report.documents.documentCount, 8);
  assert.equal(report.documents.sourceCharCount > 0, true);
  assert.equal(report.documents.order.mode, 'relevant-last');
  assert.deepEqual(report.documents.order.orderedDocumentIds.slice(0, 2), [
    'maya-chen-newhire-packet-small-007',
    'maya-chen-newhire-packet-small-008',
  ]);
  assert.deepEqual(safeIndex.documents.slice(0, 2).map((doc) => doc.id), [
    'maya-chen-newhire-packet-small-007',
    'maya-chen-newhire-packet-small-008',
  ]);
  assert.deepEqual(report.qualitySummary, {
    memoryKnownRecovered: '24/24',
    memoryKnownValuePresent: '24/24',
    memoryKnownPresentAsCompositeOrAlias: 0,
    memoryKnownGenuinelyMissing: 0,
    memoryMissingAbsent: '2/2',
    memoryActiveValueRecoveryRate: 1,
    memoryOwnershipClean: '0/0',
    memoryOwnershipForbiddenLeaks: 0,
    knownFieldCorrect: '27/27',
    knownFieldWrong: 0,
    knownFieldMissing: 0,
    knownFieldAccuracy: 1,
    averagePerFormAccuracy: 1,
    abstentionAbsentCorrect: '3/3',
    abstentionFieldHallucinated: 0,
    overfillCount: 0,
    perScenario: {
      'maya-chen-newhire-i9-packet-small': {
        knownFieldCorrect: '12/12',
        knownFieldWrong: 0,
        knownFieldMissing: 0,
        knownFieldAccuracy: 1,
        abstentionAbsentCorrect: '2/2',
        abstentionFieldHallucinated: 0,
        overfillCount: 0,
      },
      'maya-chen-newhire-fw4-packet-small': {
        knownFieldCorrect: '6/6',
        knownFieldWrong: 0,
        knownFieldMissing: 0,
        knownFieldAccuracy: 1,
        abstentionAbsentCorrect: null,
        abstentionFieldHallucinated: 0,
        overfillCount: 0,
      },
      'maya-chen-newhire-direct-deposit-packet-small': {
        knownFieldCorrect: '9/9',
        knownFieldWrong: 0,
        knownFieldMissing: 0,
        knownFieldAccuracy: 1,
        abstentionAbsentCorrect: '1/1',
        abstentionFieldHallucinated: 0,
        overfillCount: 0,
      },
    },
  });
});

test('mcp packet run classifies form-fill structured-output failures with partial score context', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-packet-fill-failure-'));
  const fixture = await loadKnownSchemaFixture({
    repoRoot,
    evalUserId: 'maya-chen-newhire',
    corpusId: 'packet-small',
    documentsRoot: 'examples/eval/users/maya-chen-newhire/corpora/packet-small',
  });
  const directDepositScenario = 'maya-chen-newhire-direct-deposit-packet-small';
  const formSummaries = {
    'maya-chen-newhire-i9-packet-small': {
      knownFieldTotal: 12,
      knownFieldCorrect: 12,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 2,
      abstentionFieldAbsentCorrect: 2,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
    'maya-chen-newhire-fw4-packet-small': {
      knownFieldTotal: 6,
      knownFieldCorrect: 6,
      knownFieldMissing: 0,
      knownFieldWrong: 0,
      knownFieldAccuracy: 1,
      abstentionFieldTotal: 0,
      abstentionFieldAbsentCorrect: 0,
      abstentionFieldHallucinated: 0,
      structuralOverfillCount: 0,
      manualAttestationOverfillCount: 0,
      outOfScopeOverfillCount: 0,
      unmappedOverfillCount: 0,
    },
  };

  const result = await runMcpPacketE2E({
    repoRoot,
    args: replaceFlagValue(baseArgs, '--artifacts-root', tmp),
    env: { EVAL_AUTH_TOKEN: 'secret-token' },
    now: fixedNow,
    runners: {
      validate: async ({ args }) => {
        const reportOut = valueAfter(args, '--report-out');
        if (reportOut) {
          await writeFile(
            reportOut,
            jsonText({ schemaVersion: 1, summary: { errors: 0, warnings: 0 } }),
          );
        }
        return { exitCode: 0, lines: ['validation ok'] };
      },
      setupOpenSchemaMemory: async () => ({
        backendUserId: 'backend-maya',
        fixture,
        definitionSetup: { created: [], existing: [], skipped: [] },
      }),
      agent: async () => ({
        exitCode: 0,
        lines: ['agent ok'],
        stdout: 'EVAL_MCP_AGENT_DONE',
        stderr: '',
        timedOut: false,
        completionMarkerObserved: true,
      }),
      exportMemorySnapshot: async ({ args }) => {
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
        const scenarioId = valueAfter(args, '--scenario');
        if (scenarioId === directDepositScenario) {
          return {
            exitCode: 1,
            lines: [
              'eval fill-form failed',
              '',
              'Error: Form-fill response status was failed. This eval runner only scores success or partial responses. Detail: Form fill failed during ai_generation: [formFill.fillActions] AI response failed validation: fillActions.24.value: Invalid input: expected string, received null',
            ],
          };
        }
        return { exitCode: 0, lines: ['fill ok'] };
      },
      score: async ({ args }) => {
        const out = valueAfter(args, '--out');
        const mode = valueAfter(args, '--mode');
        const scenarioId = valueAfter(args, '--scenario');
        const summary = mode === 'open-schema-database'
          ? {
              knownPresentTotal: 24,
              knownPresentRecoveredActive: 24,
              knownPresentValuePresentActive: 24,
              knownPresentPresentAsCompositeOrAlias: 0,
              knownPresentGenuinelyMissing: 0,
              activeValueRecoveryRate: 1,
              activeValuePresenceRate: 1,
              intentionallyMissingTotal: 2,
              missingAbsentCorrect: 2,
              ownershipDecoyTotal: 0,
              ownershipDecoyClean: 0,
              ownershipDecoyAllowedScoped: 0,
              ownershipDecoyForbiddenActiveLeak: 0,
              ownershipDecoyForbiddenSuggestionLeak: 0,
            }
          : mode === 'form'
            ? formSummaries[scenarioId]
            : { mode };
        await writeFile(
          out,
          jsonText({
            schemaVersion: 1,
            scoreType: mode,
            summary,
          }),
        );
        return { exitCode: 0, lines: [`score ${mode} ok`] };
      },
    },
  });

  assert.equal(result.exitCode, 1);
  const output = result.lines.join('\n');
  assert.match(output, /stage=fill-form/);
  assert.match(output, new RegExp(`scenario=${directDepositScenario}`));
  assert.match(output, /kind=form_fill_structured_output_validation/);
  assert.match(output, /memory-known=24\/24/);
  assert.match(output, /known-fields-so-far=18\/18/);
  assert.match(output, /not-scored-scenarios=maya-chen-newhire-direct-deposit-packet-small/);
  assert.doesNotMatch(output, /secret-token/);

  const report = JSON.parse(await readFile(path.join(tmp, 'packet-evaluation-run.json'), 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.failureStage, 'fill-form');
  assert.equal(report.failureKind, 'form_fill_structured_output_validation');
  assert.equal(report.failure.scenarioId, directDepositScenario);
  assert.equal(report.failure.scoredScenarioIds.length, 2);
  assert.deepEqual(report.failure.notScoredScenarioIds, [directDepositScenario]);
  assert.equal(report.qualitySummary.memoryKnownRecovered, '24/24');
  assert.equal(report.qualitySummary.memoryKnownValuePresent, '24/24');
  assert.equal(report.qualitySummary.knownFieldCorrect, '18/18');
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
