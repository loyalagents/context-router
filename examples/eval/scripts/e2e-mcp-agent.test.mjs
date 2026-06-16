import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COMPLETION_MARKER,
  buildAgentEnvironment,
  buildAgentInvocation,
  buildMcpAgentPrompt,
  parseArgs,
  runAgentProcess,
  runMcpAgentE2E,
} from './e2e-mcp-agent.mjs';
import { validateWithSchema } from './scoring/io.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const fixedNow = () => new Date('2026-06-01T12:00:00.000Z');
const baseArgs = [
  '--agent',
  'command',
  '--schema-mode',
  'known',
  '--form-mode',
  'backend',
  '--user',
  'alex-i9-test',
  '--corpus',
  'realistic',
  '--scenario',
  'alex-i9-realistic',
  '--artifacts-root',
  '/tmp/mcp-eval-artifacts',
  '--mcp-server',
  'context-router-local',
  '--agent-command',
  'fake-agent',
];

test('mcp agent e2e CLI prints help and reports invalid args clearly', async () => {
  const help = await runMcpAgentE2E({ repoRoot, args: ['--help'] });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:e2e-mcp-agent/);

  const missing = await runMcpAgentE2E({ repoRoot, args: [], env: {} });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.lines.join('\n'), /Missing required --agent/);

  for (const [flag, expected] of [
    ['--agent', 'Missing required --agent'],
    ['--schema-mode', 'Missing required --schema-mode'],
    ['--form-mode', 'Missing required --form-mode'],
    ['--user', 'Missing required --user'],
    ['--corpus', 'Missing required --corpus'],
    ['--scenario', 'Missing required --scenario'],
    ['--artifacts-root', 'Missing required --artifacts-root'],
    ['--mcp-server', 'Missing required --mcp-server'],
  ]) {
    const args = removeFlagValue(baseArgs, flag);
    const parsed = parseArgs(args, { EVAL_AUTH_TOKEN: 'token' }, fixedNow);
    assert.equal(parsed.kind, 'usage-error');
    assert.equal(parsed.message, expected);
  }

  const noToken = parseArgs(baseArgs, {}, fixedNow);
  assert.equal(noToken.kind, 'usage-error');
  assert.match(noToken.message, /EVAL_AUTH_TOKEN/);
});

test('mcp agent parseArgs handles defaults, env fallback, overrides, and reserved modes', () => {
  const env = {
    EVAL_BACKEND_URL: 'http://env-backend',
    EVAL_GRAPHQL_URL: 'http://env-graphql',
    EVAL_AUTH_TOKEN: 'env-token',
    EVAL_MODEL_LABEL: 'env-model',
  };

  const envFallback = parseArgs(baseArgs, env, fixedNow);
  assert.equal(envFallback.kind, 'ok');
  assert.equal(envFallback.options.backendUrl, 'http://env-backend');
  assert.equal(envFallback.options.graphqlUrl, 'http://env-graphql');
  assert.equal(envFallback.options.authToken, 'env-token');
  assert.equal(envFallback.options.modelLabel, 'env-model');
  assert.equal(envFallback.options.documentsRoot, 'examples/eval/users/alex-i9-test/corpora/realistic');
  assert.equal(envFallback.options.agentTimeoutMs, 900000);
  assert.equal(envFallback.options.promptTemplate, 'examples/eval/prompts/mcp-known-schema.md');
  assert.match(
    envFallback.options.runId,
    /^mcp-known-schema-alex-i9-test-realistic-2026-06-01T12-00-00-000Z$/,
  );

  const cliOverride = parseArgs(
    [
      ...baseArgs,
      '--documents-root',
      '/private/tmp/docs',
      '--backend-url',
      'http://cli-backend',
      '--graphql-url',
      'http://cli-graphql',
      '--auth-token',
      'cli-token',
      '--agent-timeout-ms',
      '123',
      '--prompt-template',
      '/private/tmp/template.md',
      '--model-label',
      'cli-model',
      '--run-id',
      'run-123',
    ],
    env,
    fixedNow,
  );
  assert.equal(cliOverride.kind, 'ok');
  assert.equal(cliOverride.options.documentsRoot, '/private/tmp/docs');
  assert.equal(cliOverride.options.backendUrl, 'http://cli-backend');
  assert.equal(cliOverride.options.graphqlUrl, 'http://cli-graphql');
  assert.equal(cliOverride.options.authToken, 'cli-token');
  assert.equal(cliOverride.options.agentTimeoutMs, 123);
  assert.equal(cliOverride.options.promptTemplate, '/private/tmp/template.md');
  assert.equal(cliOverride.options.modelLabel, 'cli-model');
  assert.equal(cliOverride.options.runId, 'run-123');

  const openSchema = parseArgs(replaceFlagValue(baseArgs, '--schema-mode', 'open'), env, fixedNow);
  assert.equal(openSchema.kind, 'usage-error');
  assert.match(openSchema.message, /reserved/);

  const agentForm = parseArgs(replaceFlagValue(baseArgs, '--form-mode', 'agent'), env, fixedNow);
  assert.equal(agentForm.kind, 'usage-error');
  assert.match(agentForm.message, /reserved/);

  const commandWithoutCommand = parseArgs(removeFlagValue(baseArgs, '--agent-command'), env, fixedNow);
  assert.equal(commandWithoutCommand.kind, 'usage-error');
  assert.match(commandWithoutCommand.message, /--agent-command/);

  const codex = parseArgs(replaceFlagValue(baseArgs, '--agent', 'codex'), env, fixedNow);
  assert.equal(codex.kind, 'usage-error');
  assert.match(codex.message, /reserved/);

  const claudeWithoutConfig = parseArgs(replaceFlagValue(baseArgs, '--agent', 'claude'), env, fixedNow);
  assert.equal(claudeWithoutConfig.kind, 'usage-error');
  assert.match(claudeWithoutConfig.message, /--mcp-config/);

  const claude = parseArgs(
    [
      ...replaceFlagValue(baseArgs, '--agent', 'claude'),
      '--mcp-config',
      '/private/tmp/mcp.json',
    ],
    env,
    fixedNow,
  );
  assert.equal(claude.kind, 'ok');
  assert.equal(claude.options.mcpConfig, '/private/tmp/mcp.json');

  const dashPrefixedCommand = parseArgs(
    replaceFlagValue(baseArgs, '--agent-command', '--fake-agent --flag'),
    env,
    fixedNow,
  );
  assert.equal(dashPrefixedCommand.kind, 'ok');
  assert.equal(dashPrefixedCommand.options.agentCommand, '--fake-agent --flag');
});

test('mcp agent builds isolated Claude invocation and sanitized child environment', () => {
  const invocation = buildAgentInvocation({
    repoRoot,
    options: {
      agent: 'claude',
      mcpConfig: '/private/tmp/context-router-mcp.json',
      mcpServer: 'context-router-local',
    },
    artifacts: {
      agentWorkspaceRoot: '/private/tmp/agent-workspace',
      claudeSettings: '/private/tmp/claude-settings.json',
    },
  });

  assert.equal(invocation.file, 'claude');
  assert.equal(invocation.cwd, '/private/tmp/agent-workspace');
  assert.equal(invocation.args.includes('--strict-mcp-config'), true);
  assert.equal(argValue(invocation.args, '--mcp-config'), '/private/tmp/context-router-mcp.json');
  assert.equal(argValue(invocation.args, '--settings'), '/private/tmp/claude-settings.json');
  assert.equal(argValue(invocation.args, '--tools'), 'Read,Glob,Grep');
  assert.equal(argValue(invocation.args, '--allowedTools'), 'Read,Glob,Grep,mcp__context-router-local__*');

  const childEnv = buildAgentEnvironment({
    PATH: '/usr/bin',
    HOME: '/Users/example',
    EVAL_AUTH_TOKEN: 'must-not-leak',
    DATABASE_URL: 'postgres://must-not-leak',
    AUTH0_SECRET: 'must-not-leak',
    ANTHROPIC_API_KEY: 'model-provider-key',
  });
  assert.equal(childEnv.PATH, '/usr/bin');
  assert.equal(childEnv.HOME, '/Users/example');
  assert.equal(childEnv.ANTHROPIC_API_KEY, 'model-provider-key');
  assert.equal(Object.hasOwn(childEnv, 'EVAL_AUTH_TOKEN'), false);
  assert.equal(Object.hasOwn(childEnv, 'DATABASE_URL'), false);
  assert.equal(Object.hasOwn(childEnv, 'AUTH0_SECRET'), false);
});

test('mcp known-schema prompt includes safe context and excludes hidden truth', async () => {
  const parsed = parseArgs(
    [
      ...baseArgs,
      '--auth-token',
      'token',
      '--run-id',
      'prompt-test',
    ],
    {},
    fixedNow,
  );
  assert.equal(parsed.kind, 'ok');

  const result = await buildMcpAgentPrompt({
    repoRoot,
    options: parsed.options,
  });
  const prompt = result.prompt;

  assert.match(prompt, /context-router-local/);
  assert.match(prompt, /documents\/identity\/001-driver-license-upload-ocr\.txt/);
  assert.match(prompt, /Driver License Upload OCR/);
  assert.match(prompt, /alex-i9-realistic/);
  assert.match(prompt, new RegExp(COMPLETION_MARKER));

  for (const hidden of [
    'profile.yaml',
    'validation-report.json',
    'fact-storage-map.v1.json',
    'expected/filled-form.json',
    'factContract',
    'evaluationRole',
    '000-00-0292',
    '7428 Evergreen Terrace',
    '987654321',
    'Cascadia Hiring Cooperative',
  ]) {
    assert.equal(prompt.includes(hidden), false, `prompt leaked ${hidden}`);
  }
});

test('mcp agent e2e runs stages in order and writes schema-valid artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-'));
  const calls = [];
  const runners = successfulRunners({ calls });

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...baseArgsWithArtifacts(tmp),
      '--auth-token',
      'secret-token',
      '--backend-url',
      'http://user:pass@localhost:3000',
      '--graphql-url',
      'http://user:pass@localhost:3000/graphql',
      '--model-label',
      'gpt-5.4',
      '--reset-memory',
      '--skip-ensure-definitions',
      '--location-id',
      'loc-1',
      '--run-id',
      'run-123',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.deepEqual(
    calls.map((call) => call.stage),
    [
      'validate',
      'setup',
      'agent',
      'export',
      'score:database',
      'fill-form',
      'score:form',
      'score:combined',
    ],
  );

  const evaluationRunPath = path.join(tmp, 'evaluation-run.json');
  const evaluationRun = JSON.parse(await readFile(evaluationRunPath, 'utf8'));
  await validateWithSchema(repoRoot, 'evaluation-run.schema.json', evaluationRun, 'evaluation run');
  assert.equal(evaluationRun.evaluationMode, 'mcp-known-schema');
  assert.equal(evaluationRun.status, 'pass');
  assert.equal(evaluationRun.backendUserId, 'backend-user-123');
  assert.equal(evaluationRun.backendUrl, 'http://localhost:3000/');
  assert.equal(evaluationRun.graphqlUrl, 'http://localhost:3000/graphql');
  assert.equal(evaluationRun.settings.resetMemory, true);
  assert.equal(evaluationRun.settings.ensureDefinitions, false);
  assert.equal(evaluationRun.settings.autoApply, false);
  assert.equal(evaluationRun.settings.seedPreferences, false);
  assert.equal(evaluationRun.settings.agent, 'command');
  assert.equal(evaluationRun.settings.mcpConfig, null);
  assert.match(evaluationRun.settings.agentWorkspace, /agent-workspace$/);
  assert.deepEqual(
    evaluationRun.stages.map((stage) => stage.status),
    ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed'],
  );
  assert.equal(JSON.stringify(evaluationRun).includes('secret-token'), false);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  await validateWithSchema(repoRoot, 'mcp-agent-run.schema.json', mcpAgentRun, 'MCP agent run');
  assert.equal(mcpAgentRun.status, 'pass');
  assert.equal(mcpAgentRun.schemaVersion, 2);
  assert.equal(mcpAgentRun.workspace.isolatedFromRepo, true);
  assert.match(mcpAgentRun.workspace.path, /agent-workspace$/);
  assert.match(mcpAgentRun.workspace.safeDocumentIndexPath, /agent-workspace\/documents\.json$/);
  assert.match(mcpAgentRun.documents.sourceDocumentsRoot, /examples\/eval\/users\/alex-i9-test\/corpora\/realistic$/);
  assert.match(mcpAgentRun.documents.documentsRoot, /agent-workspace$/);
  assert.equal(mcpAgentRun.transcript.redactedAuthSecrets, true);
  assert.equal(mcpAgentRun.transcript.mayContainCorpusPii, true);
  assert.equal(mcpAgentRun.agent.completionMarkerObserved, true);
  assert.equal(mcpAgentRun.setup.createdDefinitionCount, 1);
  assert.equal(mcpAgentRun.setup.existingDefinitionCount, 1);
  assert.equal(mcpAgentRun.setup.skippedDefinitionCount, 0);
  assert.equal(mcpAgentRun.summary.toolCallCount, null);
  assert.equal(mcpAgentRun.summary.preferenceWriteCount, null);
  assert.equal(mcpAgentRun.summary.definitionCreateCount, null);

  const prompt = await readFile(path.join(tmp, 'mcp-agent-prompt.md'), 'utf8');
  assert.match(prompt, /documents\/identity\/001-driver-license-upload-ocr\.txt/);
  assert.match(prompt, new RegExp(escapeRegExp(path.join(tmp, 'agent-workspace'))));
  assert.equal(prompt.includes('examples/eval/users/alex-i9-test/corpora/realistic'), false);

  const safeDocumentIndex = JSON.parse(await readFile(path.join(tmp, 'agent-workspace/documents.json'), 'utf8'));
  assert.equal(safeDocumentIndex.documentCount, 1);
  assert.equal(safeDocumentIndex.documents[0].path, 'documents/identity/001-driver-license-upload-ocr.txt');
  assert.match(
    await readFile(path.join(tmp, 'agent-workspace/documents/identity/001-driver-license-upload-ocr.txt'), 'utf8'),
    /Northstar Onboard/,
  );
  await assert.rejects(
    readFile(path.join(tmp, 'agent-workspace/profile.yaml'), 'utf8'),
    /ENOENT/,
  );
  await assert.rejects(
    readFile(path.join(tmp, 'agent-workspace/manifest.json'), 'utf8'),
    /ENOENT/,
  );

  const transcript = await readFile(path.join(tmp, 'mcp-agent-transcript.txt'), 'utf8');
  assert.equal(transcript.includes('secret-token'), false);
  assert.match(transcript, /\[redacted-auth-token\]/);
  assert.match(transcript, new RegExp(COMPLETION_MARKER));

  const setupCall = calls.find((call) => call.stage === 'setup');
  assert.equal(setupCall.resetMemoryEnabled, true);
  assert.equal(setupCall.ensureDefinitionsEnabled, false);

  const agentCall = calls.find((call) => call.stage === 'agent');
  assert.equal(agentCall.artifacts.agentWorkspaceRoot, path.join(tmp, 'agent-workspace'));

  const exportArgs = calls.find((call) => call.stage === 'export').args;
  assert.equal(argValue(exportArgs, '--ingestion-mode'), 'mcp-known-schema-agent');
  assert.equal(argValue(exportArgs, '--suggestions-were-auto-applied'), 'false');
  assert.equal(argValue(exportArgs, '--location-id'), 'loc-1');
  assert.equal(argValue(exportArgs, '--run-id'), 'run-123');
});

test('mcp agent missing completion marker is diagnostic-only in v1', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-marker-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async ({ prompt, artifacts }) => {
      calls.push({ stage: 'agent', prompt, artifacts });
      return {
        exitCode: 0,
        lines: ['agent completed without marker'],
        stdout: 'done without marker',
        stderr: '',
        timedOut: false,
        durationMs: 10,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [...baseArgsWithArtifacts(tmp), '--auth-token', 'token', '--run-id', 'run-marker'],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  const agentStage = evaluationRun.stages.find((stage) => stage.name === 'run-mcp-agent');
  assert.equal(agentStage.status, 'passed');
  assert.match(agentStage.lines.join('\n'), /diagnostic-only/);

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  assert.equal(mcpAgentRun.status, 'pass');
  assert.equal(mcpAgentRun.agent.completionMarkerObserved, false);
});

test('mcp agent e2e writes partial run and skips later stages on agent failure', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-fail-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async () => {
      calls.push({ stage: 'agent' });
      return {
        exitCode: 7,
        lines: ['agent failed with secret-token'],
        stdout: 'partial stdout secret-token',
        stderr: 'bad stderr secret-token',
        timedOut: false,
        durationMs: 25,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...baseArgsWithArtifacts(tmp),
      '--auth-token',
      'secret-token',
      '--run-id',
      'run-agent-failure',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /stage=run-mcp-agent/);
  assert.match(result.lines.join('\n'), /transcript=/);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);
  assert.match(result.lines.join('\n'), /\[redacted-auth-token\]/);
  assert.deepEqual(calls.map((call) => call.stage), ['validate', 'setup', 'agent']);

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  assert.equal(evaluationRun.status, 'fail');
  assert.equal(evaluationRun.failureStage, 'run-mcp-agent');
  assert.deepEqual(
    evaluationRun.stages.slice(3).map((stage) => [stage.name, stage.status]),
    [
      ['export-stored-preferences', 'skipped'],
      ['score-database', 'skipped'],
      ['fill-form', 'skipped'],
      ['score-form', 'skipped'],
      ['score-combined', 'skipped'],
    ],
  );
  await validateWithSchema(repoRoot, 'evaluation-run.schema.json', evaluationRun, 'evaluation run');

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  assert.equal(mcpAgentRun.status, 'fail');
  assert.equal(mcpAgentRun.summary.exitCode, 7);
  assert.equal(JSON.stringify(mcpAgentRun).includes('secret-token'), false);

  const transcript = await readFile(path.join(tmp, 'mcp-agent-transcript.txt'), 'utf8');
  assert.equal(transcript.includes('secret-token'), false);
  assert.match(transcript, /\[redacted-auth-token\]/);
});

test('mcp agent e2e marks agent artifact failed when the agent stage throws', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-throw-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async () => {
      calls.push({ stage: 'agent' });
      throw new Error('agent crashed with thrown-secret-token');
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...baseArgsWithArtifacts(tmp),
      '--auth-token',
      'thrown-secret-token',
      '--run-id',
      'run-agent-throw',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /stage=run-mcp-agent/);
  assert.equal(result.lines.join('\n').includes('thrown-secret-token'), false);

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  assert.equal(mcpAgentRun.status, 'fail');
  assert.equal(mcpAgentRun.summary.exitCode, 1);
  assert.equal(mcpAgentRun.endedAt, '2026-06-01T12:00:00.000Z');
  assert.match(mcpAgentRun.error, /\[redacted-auth-token\]/);
  assert.equal(mcpAgentRun.error.includes('thrown-secret-token'), false);
});

test('command adapter captures stdout, stderr, marker, and timeout status', async () => {
  const success = await runAgentProcess({
    repoRoot,
    options: {
      agent: 'command',
      agentCommand: `node -e "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => { console.log('saw:' + data.trim()); console.error('stderr-line'); console.log('${COMPLETION_MARKER}'); });"`,
      agentTimeoutMs: 5000,
      authToken: 'token',
    },
    prompt: 'hello prompt\n',
  });
  assert.equal(success.exitCode, 0);
  assert.equal(success.timedOut, false);
  assert.equal(success.completionMarkerObserved, true);
  assert.match(success.stdout, /saw:hello prompt/);
  assert.match(success.stderr, /stderr-line/);

  const timeout = await runAgentProcess({
    repoRoot,
    options: {
      agent: 'command',
      agentCommand: 'node -e "setTimeout(() => {}, 1000)"',
      agentTimeoutMs: 20,
      authToken: 'token',
    },
    prompt: '',
  });
  assert.equal(timeout.exitCode, 1);
  assert.equal(timeout.timedOut, true);

  const envProbe = await runAgentProcess({
    repoRoot,
    options: {
      agent: 'command',
      agentCommand: `node -e "console.log(process.env.EVAL_AUTH_TOKEN || 'no-eval-token'); console.log(process.env.DATABASE_URL || 'no-db')"`,
      agentTimeoutMs: 5000,
      authToken: 'token',
    },
    prompt: '',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      EVAL_AUTH_TOKEN: 'must-not-leak',
      DATABASE_URL: 'postgres://must-not-leak',
    },
  });
  assert.equal(envProbe.exitCode, 0);
  assert.match(envProbe.stdout, /no-eval-token/);
  assert.match(envProbe.stdout, /no-db/);
  assert.equal(envProbe.stdout.includes('must-not-leak'), false);
});

function baseArgsWithArtifacts(tmp) {
  return replaceFlagValue(baseArgs, '--artifacts-root', tmp);
}

function successfulRunners({ calls, failures = {} }) {
  return {
    validate: async ({ args }) => {
      calls.push({ stage: 'validate', args });
      await writeArtifact(argValue(args, '--report-out'), {
        schemaVersion: 1,
        status: 'pass',
        summary: { errors: 0, warnings: 0 },
        corpusTruth: {
          summary: {
            hardFailures: 0,
            unsupportedDeclaredFacts: 0,
            factsMissing: 0,
            unsupportedDeclaredFactKeys: [],
          },
          documents: [],
        },
        issues: [],
      });
      return { exitCode: 0, lines: ['validation passed'] };
    },
    setup: async ({
      resetMemoryEnabled,
      ensureDefinitionsEnabled,
      documentsRoot,
    }) => {
      calls.push({
        stage: 'setup',
        resetMemoryEnabled,
        ensureDefinitionsEnabled,
        documentsRoot,
      });
      if (failures.setup) throw new Error(failures.setup);
      return {
        backendUserId: 'backend-user-123',
        reset: resetMemoryEnabled ? { preferencesDeleted: 1 } : null,
        definitionSetup: {
          created: [{ slug: 'eval.contact.phone' }],
          existing: [{ slug: 'profile.full_name' }],
          skipped: [],
        },
        fixture: {
          manifest: {
            documents: [
              {
                id: 'doc-1',
                path: 'documents/identity/001-driver-license-upload-ocr.txt',
                title: 'Driver License Upload OCR',
                category: 'identity',
                outputExtension: 'txt',
              },
            ],
          },
        },
      };
    },
    agent: async ({ prompt, artifacts }) => {
      calls.push({ stage: 'agent', prompt, artifacts });
      return {
        exitCode: 0,
        lines: ['agent finished with secret-token'],
        stdout: `agent stdout secret-token\n${COMPLETION_MARKER}\n`,
        stderr: 'agent stderr',
        timedOut: false,
        durationMs: 123,
        command: 'fake-agent --token secret-token',
      };
    },
    exportStoredPreferences: async ({ args }) => {
      calls.push({ stage: 'export', args });
      if (failures.exportStoredPreferences) return failures.exportStoredPreferences;
      await writeArtifact(argValue(args, '--out'), {
        schemaVersion: 1,
        artifactType: 'stored-preferences',
        runId: argValue(args, '--run-id'),
        userId: argValue(args, '--user'),
        corpusId: argValue(args, '--corpus'),
        storageInput: {
          ingestionMode: argValue(args, '--ingestion-mode'),
          statusesScored: ['ACTIVE'],
          suggestionsWereAutoApplied: argValue(args, '--suggestions-were-auto-applied') === 'true',
        },
        preferences: [{ slug: 'profile.full_name', value: 'Alex Jordan Rivera', status: 'ACTIVE' }],
        diagnostics: {
          backendUserId: 'backend-user-123',
        },
      });
      return { exitCode: 0, lines: ['export passed'] };
    },
    score: async ({ args }) => {
      const mode = argValue(args, '--mode');
      calls.push({ stage: `score:${mode}`, args });
      if (mode === 'database') {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'database-storage',
          summary: { knownPresentTotal: 1, knownPresentCorrect: 0 },
        });
      } else if (mode === 'form') {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'form-fill',
          summary: { knownFieldTotal: 1, knownFieldCorrect: 0 },
        });
      } else {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'combined',
          summary: { factTotal: 1, stageAttributionCounts: {} },
        });
      }
      return { exitCode: 0, lines: [`score ${mode} passed`] };
    },
    fillForm: async ({ args }) => {
      calls.push({ stage: 'fill-form', args });
      await writeArtifact(argValue(args, '--out'), {
        schemaVersion: 1,
        snapshotType: 'filled-form',
        response: { status: 'success' },
        fields: [],
      });
      await writeFile(argValue(args, '--filled-pdf-out'), Buffer.from('%PDF fake\n'));
      await writeArtifact(argValue(args, '--response-out'), {
        schemaVersion: 1,
        artifactType: 'form-fill-response',
      });
      return { exitCode: 0, lines: ['fill passed'] };
    },
  };
}

async function writeArtifact(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, jsonText(value));
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function removeFlagValue(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return [...args.slice(0, index), ...args.slice(index + 2)];
}

function replaceFlagValue(args, flag, value) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return [...args.slice(0, index + 1), value, ...args.slice(index + 2)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
