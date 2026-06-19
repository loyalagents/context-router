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
  captureDefinitionBaseline,
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
  '--allow-test-command-agent',
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
  assert.equal(envFallback.options.ensureDefinitions, true);
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
  assert.equal(openSchema.kind, 'ok');
  assert.equal(openSchema.options.promptTemplate, 'examples/eval/prompts/mcp-open-schema.md');
  assert.equal(openSchema.options.ensureDefinitions, false);
  assert.match(
    openSchema.options.runId,
    /^mcp-open-schema-alex-i9-test-realistic-2026-06-01T12-00-00-000Z$/,
  );

  const resetDemoData = parseArgs(
    [...replaceFlagValue(baseArgs, '--schema-mode', 'open'), '--reset-demo-data'],
    env,
    fixedNow,
  );
  assert.equal(resetDemoData.kind, 'ok');
  assert.equal(resetDemoData.options.resetMemory, true);
  assert.equal(resetDemoData.options.resetMemoryMode, 'DEMO_DATA');

  const conflictingReset = parseArgs(
    [...baseArgs, '--reset-memory', '--reset-demo-data'],
    env,
    fixedNow,
  );
  assert.equal(conflictingReset.kind, 'usage-error');
  assert.match(conflictingReset.message, /mutually exclusive/);

  const agentForm = parseArgs(replaceFlagValue(baseArgs, '--form-mode', 'agent'), env, fixedNow);
  assert.equal(agentForm.kind, 'usage-error');
  assert.match(agentForm.message, /reserved/);

  const openClaude = parseArgs(
    [
      ...replaceFlagValue(claudeArgsWithoutConfig('/tmp/mcp-eval-artifacts'), '--schema-mode', 'open'),
      '--mcp-config',
      '/private/tmp/mcp.json',
    ],
    env,
    fixedNow,
  );
  assert.equal(openClaude.kind, 'ok');
  assert.equal(openClaude.options.promptTemplate, 'examples/eval/prompts/mcp-open-schema.md');
  assert.equal(openClaude.options.ensureDefinitions, false);
  assert.match(
    openClaude.options.runId,
    /^mcp-open-schema-alex-i9-test-realistic-2026-06-01T12-00-00-000Z$/,
  );

  const openClaudeWithoutConfig = parseArgs(
    replaceFlagValue(claudeArgsWithoutConfig('/tmp/mcp-eval-artifacts'), '--schema-mode', 'open'),
    env,
    fixedNow,
  );
  assert.equal(openClaudeWithoutConfig.kind, 'usage-error');
  assert.match(openClaudeWithoutConfig.message, /--mcp-config/);

  const commandWithoutCommand = parseArgs(removeFlagValue(baseArgs, '--agent-command'), env, fixedNow);
  assert.equal(commandWithoutCommand.kind, 'usage-error');
  assert.match(commandWithoutCommand.message, /--agent-command/);

  const commandWithoutTestOptIn = parseArgs(removeFlag(baseArgs, '--allow-test-command-agent'), env, fixedNow);
  assert.equal(commandWithoutTestOptIn.kind, 'usage-error');
  assert.match(commandWithoutTestOptIn.message, /test adapter/);

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
  assert.equal(argValue(invocation.args, '--tools'), 'Read,Glob,Grep,ToolSearch');
  assert.equal(
    argValue(invocation.args, '--allowedTools'),
    'Read,Glob,Grep,ToolSearch,mcp__context-router-local__*',
  );

  const childEnv = buildAgentEnvironment({
    PATH: '/usr/bin',
    HOME: '/Users/example',
    EVAL_AUTH_TOKEN: 'must-not-leak',
    DATABASE_URL: 'postgres://must-not-leak',
    AUTH0_SECRET: 'must-not-leak',
    ANTHROPIC_API_KEY: 'model-provider-key',
    CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth-token',
    CLAUDE_CONFIG_DIR: '/tmp/claude-config',
    CLAUDE_CODE_USE_VERTEX: '1',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/google-credentials.json',
    CLAUDE_CODE_USE_BEDROCK: '1',
    AWS_ACCESS_KEY_ID: 'aws-access-key',
    AWS_SECRET_ACCESS_KEY: 'aws-secret-key',
    CLAUDE_CODE_USE_FOUNDRY: '1',
    AZURE_CLIENT_ID: 'azure-client-id',
  });
  assert.equal(childEnv.PATH, '/usr/bin');
  assert.equal(childEnv.HOME, '/Users/example');
  assert.equal(childEnv.ANTHROPIC_API_KEY, 'model-provider-key');
  assert.equal(childEnv.CLAUDE_CODE_OAUTH_TOKEN, 'claude-oauth-token');
  assert.equal(childEnv.CLAUDE_CONFIG_DIR, '/tmp/claude-config');
  assert.equal(childEnv.CLAUDE_CODE_USE_VERTEX, '1');
  assert.equal(childEnv.GOOGLE_APPLICATION_CREDENTIALS, '/tmp/google-credentials.json');
  assert.equal(childEnv.CLAUDE_CODE_USE_BEDROCK, '1');
  assert.equal(childEnv.AWS_ACCESS_KEY_ID, 'aws-access-key');
  assert.equal(childEnv.AWS_SECRET_ACCESS_KEY, 'aws-secret-key');
  assert.equal(childEnv.CLAUDE_CODE_USE_FOUNDRY, '1');
  assert.equal(childEnv.AZURE_CLIENT_ID, 'azure-client-id');
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

test('mcp open-schema prompt permits schema creation without hidden truth leakage', async () => {
  const parsed = parseArgs(
    [
      ...replaceFlagValue(baseArgs, '--schema-mode', 'open'),
      '--auth-token',
      'token',
      '--run-id',
      'prompt-open-test',
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

  assert.match(prompt, /MCP Open-Schema Memory Ingestion Eval/);
  assert.match(prompt, /Create useful definitions and slugs/);
  assert.match(prompt, /Reuse existing definitions/);
  assert.equal(prompt.includes('do not invent new definitions'), false);
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

test('captureDefinitionBaseline writes schema-valid baselines and rejects user mismatches', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-baseline-'));
  const options = {
    userId: 'alex-i9-test',
    corpusId: 'realistic',
    scenarioId: 'alex-i9-realistic',
    graphqlUrl: 'http://user:pass@localhost:3000/graphql',
    authToken: 'secret-token',
    locationId: 'loc-1',
  };
  const artifacts = {
    definitionBaseline: path.join(tmp, 'definition-baseline.json'),
  };
  const setupResult = {
    backendUserId: 'backend-user-123',
  };
  const requests = [];
  const result = await captureDefinitionBaseline({
    repoRoot,
    options,
    artifacts,
    setupResult,
    now: fixedNow,
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return jsonResponse({
        data: {
          me: { userId: 'backend-user-123' },
          activePreferences: [],
          exportPreferenceSchema: [
            definitionRow({ id: 'def-b', slug: 'zeta.value' }),
            definitionRow({ id: 'def-a', slug: 'alpha.value' }),
          ],
        },
      });
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://user:pass@localhost:3000/graphql');
  assert.equal(requests[0].request.headers.authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(requests[0].request.body).variables, {
    locationId: 'loc-1',
    includeSuggestions: false,
  });

  const artifact = JSON.parse(await readFile(artifacts.definitionBaseline, 'utf8'));
  await validateWithSchema(repoRoot, 'definition-baseline.schema.json', artifact, 'definition baseline');
  assert.equal(artifact.artifactType, 'definition-baseline');
  assert.equal(artifact.backendUserId, 'backend-user-123');
  assert.equal(artifact.strategy, 'baseline-only');
  assert.deepEqual(artifact.definitionIds, ['def-a', 'def-b']);
  assert.deepEqual(artifact.slugs, ['alpha.value', 'zeta.value']);
  assert.equal(artifact.diagnostics.graphqlUrl, 'http://localhost:3000/graphql');

  await assert.rejects(
    captureDefinitionBaseline({
      repoRoot,
      options,
      artifacts: { definitionBaseline: path.join(tmp, 'missing-user.json') },
      setupResult,
      now: fixedNow,
      fetchImpl: async () =>
        jsonResponse({
          data: {
            me: {},
            activePreferences: [],
            exportPreferenceSchema: [],
          },
        }),
    }),
    /did not include me\.userId/,
  );

  await assert.rejects(
    captureDefinitionBaseline({
      repoRoot,
      options,
      artifacts: { definitionBaseline: path.join(tmp, 'wrong-user.json') },
      setupResult,
      now: fixedNow,
      fetchImpl: async () =>
        jsonResponse({
          data: {
            me: { userId: 'other-backend-user' },
            activePreferences: [],
            exportPreferenceSchema: [],
          },
        }),
    }),
    /does not match setup backend user backend-user-123/,
  );
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
  assert.equal(evaluationRun.settings.resetMode, 'MEMORY_ONLY');
  assert.equal(evaluationRun.settings.ensureDefinitions, false);
  assert.equal(evaluationRun.settings.autoApply, false);
  assert.equal(evaluationRun.settings.seedPreferences, false);
  assert.equal(evaluationRun.settings.agent, 'command');
  assert.equal(evaluationRun.settings.commandAdapterTestOnly, true);
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
  await assert.rejects(
    validateWithSchema(
      repoRoot,
      'mcp-agent-run.schema.json',
      {
        ...mcpAgentRun,
        artifacts: {
          ...mcpAgentRun.artifacts,
          memorySnapshot: 'memory-snapshot.json',
        },
      },
      'MCP agent run with cross-mode artifact',
    ),
    /must NOT be valid/,
  );
  assert.equal(mcpAgentRun.status, 'pass');
  assert.equal(mcpAgentRun.schemaVersion, 3);
  assert.equal(mcpAgentRun.identity.runnerBackendUserId, 'backend-user-123');
  assert.equal(mcpAgentRun.identity.mcpBackendUserId, null);
  assert.equal(mcpAgentRun.identity.verifiedSameBackendUser, false);
  assert.equal(mcpAgentRun.identity.verificationMethod, 'not-implemented');
  assert.equal(mcpAgentRun.workspace.containsOnlyDeclaredDocuments, true);
  assert.equal(mcpAgentRun.workspace.hardFilesystemBoundary, false);
  assert.match(mcpAgentRun.workspace.path, /agent-workspace$/);
  assert.match(mcpAgentRun.workspace.safeDocumentIndexPath, /agent-workspace\/documents\.json$/);
  assert.match(mcpAgentRun.documents.sourceDocumentsRoot, /examples\/eval\/users\/alex-i9-test\/corpora\/realistic$/);
  assert.match(mcpAgentRun.documents.documentsRoot, /agent-workspace$/);
  assert.equal(mcpAgentRun.transcript.redactedAuthSecrets, true);
  assert.equal(mcpAgentRun.transcript.mayContainCorpusPii, true);
  assert.equal(mcpAgentRun.agent.completionMarkerObserved, true);
  assert.equal(mcpAgentRun.setup.resetMode, 'MEMORY_ONLY');
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
  assert.equal(setupCall.resetMemoryMode, 'MEMORY_ONLY');
  assert.equal(setupCall.ensureDefinitionsEnabled, false);

  const agentCall = calls.find((call) => call.stage === 'agent');
  assert.equal(agentCall.artifacts.agentWorkspaceRoot, path.join(tmp, 'agent-workspace'));

  const exportArgs = calls.find((call) => call.stage === 'export').args;
  assert.equal(argValue(exportArgs, '--ingestion-mode'), 'mcp-known-schema-agent');
  assert.equal(argValue(exportArgs, '--suggestions-were-auto-applied'), 'false');
  assert.equal(argValue(exportArgs, '--location-id'), 'loc-1');
  assert.equal(argValue(exportArgs, '--run-id'), 'run-123');
});

test('mcp open-schema command adapter runs open stages and writes schema-valid artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-open-e2e-'));
  const calls = [];
  const runners = successfulRunners({ calls });

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...replaceFlagValue(baseArgsWithArtifacts(tmp), '--schema-mode', 'open'),
      '--auth-token',
      'secret-token',
      '--reset-demo-data',
      '--location-id',
      'loc-1',
      '--run-id',
      'run-open-123',
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
      'capture-definition-baseline',
      'agent',
      'export-memory-snapshot',
      'score:open-schema-database',
      'fill-form',
      'score:form',
      'score:open-schema-combined',
    ],
  );

  const setupCall = calls.find((call) => call.stage === 'setup');
  assert.equal(setupCall.ensureDefinitionsEnabled, false);
  assert.equal(setupCall.resetMemoryEnabled, true);
  assert.equal(setupCall.resetMemoryMode, 'DEMO_DATA');

  const exportArgs = calls.find((call) => call.stage === 'export-memory-snapshot').args;
  assert.equal(argValue(exportArgs, '--schema-mode'), 'open');
  assert.equal(argValue(exportArgs, '--schema-reset-mode'), 'baseline-only');
  assert.equal(argValue(exportArgs, '--baseline-in'), path.join(tmp, 'definition-baseline.json'));
  assert.equal(argValue(exportArgs, '--producer'), 'mcp-open-schema-agent');
  assert.equal(exportArgs.includes('--include-suggestions'), true);
  assert.equal(argValue(exportArgs, '--location-id'), 'loc-1');

  const openDatabaseArgs = calls.find((call) => call.stage === 'score:open-schema-database').args;
  assert.equal(argValue(openDatabaseArgs, '--memory-snapshot'), path.join(tmp, 'memory-snapshot.json'));
  assert.equal(
    argValue(openDatabaseArgs, '--out'),
    path.join(tmp, 'open-schema-database-score-report.json'),
  );
  const openCombinedArgs = calls.find((call) => call.stage === 'score:open-schema-combined').args;
  assert.equal(
    argValue(openCombinedArgs, '--open-schema-database-report'),
    path.join(tmp, 'open-schema-database-score-report.json'),
  );
  assert.equal(
    argValue(openCombinedArgs, '--out'),
    path.join(tmp, 'open-schema-combined-score-report.json'),
  );

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  await validateWithSchema(repoRoot, 'evaluation-run.schema.json', evaluationRun, 'evaluation run');
  assert.equal(evaluationRun.evaluationMode, 'mcp-open-schema');
  assert.equal(evaluationRun.settings.schemaMode, 'open');
  assert.equal(evaluationRun.settings.ensureDefinitions, false);
  assert.equal(evaluationRun.settings.resetMemory, true);
  assert.equal(evaluationRun.settings.resetMode, 'DEMO_DATA');
  assert.deepEqual(
    evaluationRun.stages.map((stage) => stage.name),
    [
      'validate-documents',
      'setup-open-schema-memory',
      'capture-definition-baseline',
      'run-mcp-agent',
      'export-memory-snapshot',
      'score-open-schema-database',
      'fill-form',
      'score-form',
      'score-open-schema-combined',
    ],
  );
  assert.deepEqual(
    evaluationRun.stages.map((stage) => stage.status),
    ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed'],
  );
  assert.match(evaluationRun.stages[2].artifacts.definitionBaseline, /definition-baseline\.json$/);
  assert.match(evaluationRun.stages[4].artifacts.memorySnapshot, /memory-snapshot\.json$/);
  assert.match(
    evaluationRun.stages[5].artifacts.openSchemaDatabaseScoreReport,
    /open-schema-database-score-report\.json$/,
  );
  assert.match(
    evaluationRun.stages[8].artifacts.openSchemaCombinedScoreReport,
    /open-schema-combined-score-report\.json$/,
  );

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  await validateWithSchema(repoRoot, 'mcp-agent-run.schema.json', mcpAgentRun, 'MCP agent run');
  await assert.rejects(
    validateWithSchema(
      repoRoot,
      'mcp-agent-run.schema.json',
      {
        ...mcpAgentRun,
        artifacts: {
          ...mcpAgentRun.artifacts,
          storedPreferences: 'stored-preferences.json',
        },
      },
      'MCP agent run with cross-mode artifact',
    ),
    /must NOT be valid/,
  );
  assert.equal(mcpAgentRun.schemaMode, 'open');
  assert.equal(mcpAgentRun.setup.knownSchemaDefinitionsEnsured, false);
  assert.equal(mcpAgentRun.setup.resetMemory, true);
  assert.equal(mcpAgentRun.setup.resetMode, 'DEMO_DATA');
  assert.equal(mcpAgentRun.prompt.templatePath, 'examples/eval/prompts/mcp-open-schema.md');
  assert.deepEqual(Object.keys(mcpAgentRun.artifacts).sort(), [
    'definitionBaseline',
    'evaluationRun',
    'filledForm',
    'filledPdf',
    'formFillResponse',
    'formScoreReport',
    'memorySnapshot',
    'openSchemaCombinedScoreReport',
    'openSchemaDatabaseScoreReport',
    'validationReport',
  ]);
});

test('mcp open-schema Claude adapter runs open stages and writes schema-valid artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-open-claude-e2e-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async ({ prompt, artifacts, options }) => {
      calls.push({ stage: 'agent', prompt, artifacts, options });
      return {
        exitCode: 0,
        lines: ['claude finished'],
        stdout: [
          claudeInitLine({ mcpServer: 'context-router-local' }),
          'claude wrote open-schema memory',
          COMPLETION_MARKER,
          '',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 123,
        command: 'claude --mcp-config /private/tmp/context-router-mcp.json',
        completionMarkerObserved: true,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...replaceFlagValue(claudeArgsWithArtifacts(tmp), '--schema-mode', 'open'),
      '--auth-token',
      'secret-token',
      '--run-id',
      'run-open-claude-123',
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
      'capture-definition-baseline',
      'agent',
      'export-memory-snapshot',
      'score:open-schema-database',
      'fill-form',
      'score:form',
      'score:open-schema-combined',
    ],
  );

  const agentCall = calls.find((call) => call.stage === 'agent');
  assert.equal(agentCall.options.agent, 'claude');
  assert.equal(agentCall.options.schemaMode, 'open');
  assert.match(agentCall.prompt, /EVAL_MCP_AGENT_DONE/);

  const exportArgs = calls.find((call) => call.stage === 'export-memory-snapshot').args;
  assert.equal(argValue(exportArgs, '--schema-mode'), 'open');
  assert.equal(argValue(exportArgs, '--schema-reset-mode'), 'baseline-only');
  assert.equal(argValue(exportArgs, '--baseline-in'), path.join(tmp, 'definition-baseline.json'));
  assert.equal(exportArgs.includes('--include-suggestions'), true);

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  await validateWithSchema(repoRoot, 'evaluation-run.schema.json', evaluationRun, 'evaluation run');
  assert.equal(evaluationRun.evaluationMode, 'mcp-open-schema');
  assert.equal(evaluationRun.settings.agent, 'claude');
  assert.equal(evaluationRun.settings.schemaMode, 'open');
  assert.deepEqual(
    evaluationRun.stages.map((stage) => stage.name),
    [
      'validate-documents',
      'setup-open-schema-memory',
      'capture-definition-baseline',
      'run-mcp-agent',
      'export-memory-snapshot',
      'score-open-schema-database',
      'fill-form',
      'score-form',
      'score-open-schema-combined',
    ],
  );
  assert.deepEqual(
    evaluationRun.stages.map((stage) => stage.status),
    ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed'],
  );

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  await validateWithSchema(repoRoot, 'mcp-agent-run.schema.json', mcpAgentRun, 'MCP agent run');
  assert.equal(mcpAgentRun.agent.provider, 'claude');
  assert.equal(mcpAgentRun.schemaMode, 'open');
  assert.equal(mcpAgentRun.identity.verifiedSameBackendUser, false);
  assert.equal(mcpAgentRun.identity.verificationMethod, 'not-implemented');
  assert.equal(mcpAgentRun.prompt.templatePath, 'examples/eval/prompts/mcp-open-schema.md');
  assert.match(mcpAgentRun.agent.command, /--strict-mcp-config/);
  assert.match(mcpAgentRun.agent.command, /--mcp-config/);
  assert.match(mcpAgentRun.agent.command, /context-router-mcp\.json/);
  assert.match(mcpAgentRun.agent.command, /mcp__context-router-local__\*/);
});

test('mcp agent e2e accepts deferred Claude MCP tools when init is pending', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-claude-deferred-tools-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async () => {
      calls.push({ stage: 'agent' });
      return {
        exitCode: 0,
        lines: ['claude used deferred MCP tools'],
        stdout: [
          claudeInitLine({
            mcpServer: 'context-router-local',
            serverStatus: 'pending',
            tools: ['Read', 'Glob', 'Grep', 'ToolSearch'],
          }),
          JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  content: [
                    {
                      type: 'tool_reference',
                      tool_name: 'mcp__context-router-local__listPreferenceSlugs',
                    },
                  ],
                },
              ],
            },
          }),
          JSON.stringify({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: 'mcp__context-router-local__listPreferenceSlugs',
                  input: {},
                },
              ],
            },
          }),
          COMPLETION_MARKER,
          '',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 10,
        completionMarkerObserved: true,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [...claudeArgsWithArtifacts(tmp), '--auth-token', 'token', '--run-id', 'run-claude-deferred-tools'],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  assert.equal(mcpAgentRun.status, 'pass');
  assert.equal(mcpAgentRun.agent.completionMarkerObserved, true);
});

test('command adapter missing completion marker is diagnostic-only', async () => {
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

test('mcp agent e2e fails live Claude run when completion marker is missing', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-claude-marker-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async ({ prompt, artifacts }) => {
      calls.push({ stage: 'agent', prompt, artifacts });
      return {
        exitCode: 0,
        lines: ['claude exited without completion marker'],
        stdout: `${claudeInitLine({ mcpServer: 'context-router-local' })}\n`,
        stderr: '',
        timedOut: false,
        durationMs: 10,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [...claudeArgsWithArtifacts(tmp), '--auth-token', 'token', '--run-id', 'run-claude-marker'],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /stage=run-mcp-agent/);
  assert.match(result.lines.join('\n'), /required completion marker/);
  assert.deepEqual(calls.map((call) => call.stage), ['validate', 'setup', 'agent']);

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  const agentStage = evaluationRun.stages.find((stage) => stage.name === 'run-mcp-agent');
  assert.equal(agentStage.status, 'failed');
  assert.match(agentStage.error, /required completion marker/);
  assert.equal(evaluationRun.stages.find((stage) => stage.name === 'export-stored-preferences').status, 'skipped');

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  assert.equal(mcpAgentRun.status, 'fail');
  assert.equal(mcpAgentRun.agent.provider, 'claude');
  assert.equal(mcpAgentRun.agent.completionMarkerObserved, false);
  assert.match(mcpAgentRun.error, /required completion marker/);
});

test('mcp agent e2e fails live Claude run when MCP server is disconnected', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-claude-mcp-disconnected-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async ({ prompt, artifacts }) => {
      calls.push({ stage: 'agent', prompt, artifacts });
      return {
        exitCode: 0,
        lines: ['claude exited after disconnected MCP init'],
        stdout: [
          claudeInitLine({
            mcpServer: 'context-router-local',
            serverStatus: 'failed',
            tools: ['Read', 'Glob', 'Grep'],
          }),
          COMPLETION_MARKER,
          '',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 10,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...claudeArgsWithArtifacts(tmp),
      '--auth-token',
      'token',
      '--run-id',
      'run-claude-mcp-disconnected',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /MCP server context-router-local status was failed/);
  assert.match(result.lines.join('\n'), /No Claude tools were exposed/);

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  const agentStage = evaluationRun.stages.find((stage) => stage.name === 'run-mcp-agent');
  assert.equal(agentStage.status, 'failed');
  assert.match(agentStage.error, /MCP server context-router-local status was failed/);
  assert.equal(evaluationRun.stages.find((stage) => stage.name === 'export-stored-preferences').status, 'skipped');

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  assert.equal(mcpAgentRun.status, 'fail');
  assert.equal(mcpAgentRun.agent.completionMarkerObserved, true);
  assert.match(mcpAgentRun.error, /No Claude tools were exposed/);
});

test('mcp agent e2e fails live Claude run when MCP tools are not exposed', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-claude-no-tools-'));
  const calls = [];
  const runners = {
    ...successfulRunners({ calls }),
    agent: async ({ prompt, artifacts }) => {
      calls.push({ stage: 'agent', prompt, artifacts });
      return {
        exitCode: 0,
        lines: ['claude exited without MCP tools'],
        stdout: [
          claudeInitLine({
            mcpServer: 'context-router-local',
            tools: ['Read', 'Glob', 'Grep'],
          }),
          COMPLETION_MARKER,
          '',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 10,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [...claudeArgsWithArtifacts(tmp), '--auth-token', 'token', '--run-id', 'run-claude-no-tools'],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /No Claude tools were exposed/);

  const mcpAgentRun = JSON.parse(await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8'));
  assert.equal(mcpAgentRun.status, 'fail');
  assert.equal(mcpAgentRun.agent.completionMarkerObserved, true);
  assert.match(mcpAgentRun.error, /No Claude tools were exposed/);
});

test('mcp agent transcript redacts allowed model-provider env secrets', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-env-redaction-'));
  const calls = [];
  const providerSecret = 'provider-secret-key-123456';
  const oauthSecret = 'claude-oauth-secret-123456';
  const runners = {
    ...successfulRunners({ calls }),
    agent: async () => {
      calls.push({ stage: 'agent' });
      return {
        exitCode: 0,
        lines: ['agent printed provider secrets'],
        stdout: `${providerSecret}\n${oauthSecret}\n${COMPLETION_MARKER}\n`,
        stderr: '',
        timedOut: false,
        durationMs: 10,
      };
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...baseArgsWithArtifacts(tmp),
      '--auth-token',
      'token',
      '--run-id',
      'run-env-redaction',
    ],
    env: {
      ANTHROPIC_API_KEY: providerSecret,
      CLAUDE_CODE_OAUTH_TOKEN: oauthSecret,
    },
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  const transcript = await readFile(path.join(tmp, 'mcp-agent-transcript.txt'), 'utf8');
  assert.equal(transcript.includes(providerSecret), false);
  assert.equal(transcript.includes(oauthSecret), false);
  assert.match(transcript, /\[redacted-auth-token\]/);
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

test('mcp open-schema agent failure skips memory export and later open stages', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-open-fail-'));
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
      ...replaceFlagValue(baseArgsWithArtifacts(tmp), '--schema-mode', 'open'),
      '--auth-token',
      'secret-token',
      '--run-id',
      'run-open-agent-failure',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /stage=run-mcp-agent/);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);
  assert.deepEqual(calls.map((call) => call.stage), [
    'validate',
    'setup',
    'capture-definition-baseline',
    'agent',
  ]);

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  assert.equal(evaluationRun.status, 'fail');
  assert.equal(evaluationRun.failureStage, 'run-mcp-agent');
  assert.deepEqual(
    evaluationRun.stages.slice(4).map((stage) => [stage.name, stage.status]),
    [
      ['export-memory-snapshot', 'skipped'],
      ['score-open-schema-database', 'skipped'],
      ['fill-form', 'skipped'],
      ['score-form', 'skipped'],
      ['score-open-schema-combined', 'skipped'],
    ],
  );
  await validateWithSchema(repoRoot, 'evaluation-run.schema.json', evaluationRun, 'evaluation run');
});

test('mcp open-schema baseline failure marks baseline stage and skips later stages', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-open-baseline-fail-'));
  const calls = [];
  const runners = successfulRunners({
    calls,
    failures: {
      captureDefinitionBaseline: {
        exitCode: 1,
        lines: ['baseline failed with secret-token'],
      },
    },
  });

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...replaceFlagValue(baseArgsWithArtifacts(tmp), '--schema-mode', 'open'),
      '--auth-token',
      'secret-token',
      '--run-id',
      'run-open-baseline-failure',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /stage=capture-definition-baseline/);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);
  assert.match(result.lines.join('\n'), /\[redacted-auth-token\]/);
  assert.deepEqual(calls.map((call) => call.stage), [
    'validate',
    'setup',
    'capture-definition-baseline',
  ]);

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  assert.equal(evaluationRun.failureStage, 'capture-definition-baseline');
  assert.deepEqual(
    evaluationRun.stages.slice(3).map((stage) => [stage.name, stage.status]),
    [
      ['run-mcp-agent', 'skipped'],
      ['export-memory-snapshot', 'skipped'],
      ['score-open-schema-database', 'skipped'],
      ['fill-form', 'skipped'],
      ['score-form', 'skipped'],
      ['score-open-schema-combined', 'skipped'],
    ],
  );
  await validateWithSchema(repoRoot, 'evaluation-run.schema.json', evaluationRun, 'evaluation run');
});

test('mcp open-schema memory snapshot export failure marks export stage and skips scoring', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-open-export-fail-'));
  const calls = [];
  const runners = successfulRunners({
    calls,
    failures: {
      exportMemorySnapshot: {
        exitCode: 1,
        lines: ['memory snapshot failed with secret-token'],
      },
    },
  });

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...replaceFlagValue(baseArgsWithArtifacts(tmp), '--schema-mode', 'open'),
      '--auth-token',
      'secret-token',
      '--run-id',
      'run-open-export-failure',
    ],
    env: {},
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /stage=export-memory-snapshot/);
  assert.equal(result.lines.join('\n').includes('secret-token'), false);
  assert.deepEqual(calls.map((call) => call.stage), [
    'validate',
    'setup',
    'capture-definition-baseline',
    'agent',
    'export-memory-snapshot',
  ]);

  const evaluationRun = JSON.parse(await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8'));
  assert.equal(evaluationRun.failureStage, 'export-memory-snapshot');
  assert.deepEqual(
    evaluationRun.stages.slice(5).map((stage) => [stage.name, stage.status]),
    [
      ['score-open-schema-database', 'skipped'],
      ['fill-form', 'skipped'],
      ['score-form', 'skipped'],
      ['score-open-schema-combined', 'skipped'],
    ],
  );
  await validateWithSchema(repoRoot, 'evaluation-run.schema.json', evaluationRun, 'evaluation run');
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

test('mcp agent e2e redacts provider secrets from thrown agent stage failures', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-agent-e2e-provider-throw-'));
  const calls = [];
  const providerSecret = 'provider-secret-key-123456';
  const oauthSecret = 'claude-oauth-secret-123456';
  const runners = {
    ...successfulRunners({ calls }),
    agent: async () => {
      calls.push({ stage: 'agent' });
      throw new Error(`agent crashed with ${providerSecret} and ${oauthSecret}`);
    },
  };

  const result = await runMcpAgentE2E({
    repoRoot,
    args: [
      ...baseArgsWithArtifacts(tmp),
      '--auth-token',
      'token',
      '--run-id',
      'run-provider-throw',
    ],
    env: {
      ANTHROPIC_API_KEY: providerSecret,
      CLAUDE_CODE_OAUTH_TOKEN: oauthSecret,
    },
    runners,
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.lines.join('\n').includes(providerSecret), false);
  assert.equal(result.lines.join('\n').includes(oauthSecret), false);
  assert.match(result.lines.join('\n'), /\[redacted-auth-token\]/);

  const evaluationRunText = await readFile(path.join(tmp, 'evaluation-run.json'), 'utf8');
  assert.equal(evaluationRunText.includes(providerSecret), false);
  assert.equal(evaluationRunText.includes(oauthSecret), false);
  assert.match(evaluationRunText, /\[redacted-auth-token\]/);

  const mcpAgentRunText = await readFile(path.join(tmp, 'mcp-agent-run.json'), 'utf8');
  assert.equal(mcpAgentRunText.includes(providerSecret), false);
  assert.equal(mcpAgentRunText.includes(oauthSecret), false);
  assert.match(mcpAgentRunText, /\[redacted-auth-token\]/);
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

function claudeArgsWithoutConfig(tmp) {
  return removeFlagValue(
    removeFlag(replaceFlagValue(baseArgsWithArtifacts(tmp), '--agent', 'claude'), '--allow-test-command-agent'),
    '--agent-command',
  );
}

function claudeArgsWithArtifacts(tmp) {
  return [
    ...claudeArgsWithoutConfig(tmp),
    '--mcp-config',
    '/private/tmp/context-router-mcp.json',
  ];
}

function claudeInitLine({
  mcpServer,
  serverStatus = 'connected',
  tools = ['Read', 'Glob', 'Grep', `mcp__${mcpServer}__listPreferenceSlugs`],
}) {
  return JSON.stringify({
    type: 'system',
    subtype: 'init',
    tools,
    mcp_servers: [{ name: mcpServer, status: serverStatus }],
  });
}

function successfulRunners({ calls, failures = {} }) {
  const setupRunner = async ({
    resetMemoryEnabled,
    resetMemoryMode,
    ensureDefinitionsEnabled,
    documentsRoot,
  }) => {
    calls.push({
      stage: 'setup',
      resetMemoryEnabled,
      resetMemoryMode,
      ensureDefinitionsEnabled,
      documentsRoot,
    });
    if (failures.setup) throw new Error(failures.setup);
    return {
      backendUserId: 'backend-user-123',
      reset: resetMemoryEnabled
        ? {
            mode: resetMemoryMode ?? 'MEMORY_ONLY',
            preferencesDeleted: 1,
            preferenceDefinitionsDeleted: resetMemoryMode === 'DEMO_DATA' ? 2 : 0,
          }
        : null,
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
  };

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
    setup: setupRunner,
    setupOpenSchemaMemory: (params) =>
      setupRunner({
        ...params,
        ensureDefinitionsEnabled: false,
      }),
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
    captureDefinitionBaseline: async ({ artifacts, setupResult }) => {
      calls.push({ stage: 'capture-definition-baseline', artifacts, setupResult });
      if (failures.captureDefinitionBaseline) return failures.captureDefinitionBaseline;
      await writeArtifact(artifacts.definitionBaseline, {
        schemaVersion: 1,
        artifactType: 'definition-baseline',
        userId: 'alex-i9-test',
        corpusId: 'realistic',
        scenarioId: 'alex-i9-realistic',
        backendUserId: 'backend-user-123',
        capturedAt: '2026-06-01T12:00:00.000Z',
        strategy: 'baseline-only',
        definitionIds: ['def-existing'],
        slugs: ['profile.full_name'],
        definitions: [
          {
            id: 'def-existing',
            namespace: 'user',
            slug: 'profile.full_name',
            displayName: 'Full name',
            ownerUserId: null,
            archivedAt: null,
            description: 'Full legal name',
            valueType: 'TEXT',
            scope: 'USER',
            options: null,
            isSensitive: false,
            isCore: true,
            category: 'profile',
          },
        ],
        diagnostics: {
          graphqlUrl: 'http://localhost:3000/graphql',
          definitionCount: 1,
        },
      });
      return { exitCode: 0, lines: ['definition baseline captured'] };
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
    exportMemorySnapshot: async ({ args }) => {
      calls.push({ stage: 'export-memory-snapshot', args });
      if (failures.exportMemorySnapshot) return failures.exportMemorySnapshot;
      await writeArtifact(argValue(args, '--out'), {
        schemaVersion: 1,
        artifactType: 'memory-snapshot',
        runId: argValue(args, '--run-id'),
        evaluationMode: 'mcp-open-schema',
        userId: argValue(args, '--user'),
        corpusId: argValue(args, '--corpus'),
        scenarioId: argValue(args, '--scenario'),
        storageInput: {
          schemaMode: argValue(args, '--schema-mode'),
          producer: argValue(args, '--producer'),
          statusesScored: ['ACTIVE'],
          suggestionsWereAutoApplied: false,
        },
        preferences: [],
        suggestions: [],
        definitions: [],
        definitionBaseline: {
          capturedBeforeRun: true,
          capturedAt: '2026-06-01T12:00:00.000Z',
          strategy: 'baseline-only',
          preexistingDefinitionIds: ['def-existing'],
          preexistingSlugs: ['profile.full_name'],
          newDefinitionIds: [],
          newSlugs: [],
          removedDefinitionIds: [],
          removedSlugs: [],
        },
        diagnostics: {
          exportedAt: '2026-06-01T12:00:00.000Z',
          graphqlUrl: 'http://localhost:3000/graphql',
          queryName: 'EvalMemorySnapshotExport',
          locationMode: argValue(args, '--location-id') ? 'merged-location' : 'global-only',
          locationId: argValue(args, '--location-id') ?? null,
          preferencesMergedWithLocation: Boolean(argValue(args, '--location-id')),
          includeSuggestions: args.includes('--include-suggestions'),
          activePreferenceCount: 0,
          suggestedPreferenceCount: 0,
          definitionCount: 0,
          backendUserId: 'backend-user-123',
          schemaMode: argValue(args, '--schema-mode'),
          schemaResetMode: argValue(args, '--schema-reset-mode'),
        },
      });
      return { exitCode: 0, lines: ['memory snapshot export passed'] };
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
      } else if (mode === 'open-schema-database') {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'open-schema-database-storage',
          summary: { knownPresentTotal: 1, knownPresentRecovered: 0 },
        });
      } else if (mode === 'open-schema-combined') {
        await writeArtifact(argValue(args, '--out'), {
          schemaVersion: 1,
          scoreType: 'open-schema-combined',
          summary: { factTotal: 1, stageAttributionCounts: {} },
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

function removeFlag(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return [...args.slice(0, index), ...args.slice(index + 1)];
}

function replaceFlagValue(args, flag, value) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return [...args.slice(0, index + 1), value, ...args.slice(index + 2)];
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function definitionRow(overrides = {}) {
  return {
    id: 'def-1',
    namespace: 'user',
    slug: 'profile.full_name',
    displayName: 'Full name',
    ownerUserId: null,
    archivedAt: null,
    description: 'Full legal name',
    valueType: 'TEXT',
    scope: 'USER',
    options: null,
    isSensitive: false,
    isCore: true,
    category: 'profile',
    ...overrides,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
