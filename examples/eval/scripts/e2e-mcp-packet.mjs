#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPLETION_MARKER,
  buildAgentInvocation,
  mcpThinkingMetadata,
  prepareAgentWorkspace,
  prepareOpenSchemaMemory,
  runAgentProcess,
} from './e2e-mcp-agent.mjs';
import {
  modelMetadata,
  validateThinkingMode,
} from './claude-code-cli.mjs';
import {
  MCP_OPEN_SCHEMA_EVALUATION_MODE,
  MCP_OPEN_SCHEMA_PRODUCER,
  OPEN_SCHEMA_BASELINE_RESET_MODE,
} from './eval-constants.mjs';
import { loadKnownSchemaFixture } from './ingestor/setup.mjs';
import {
  formatExportMemorySnapshotResult,
  runExportMemorySnapshot,
} from './export-memory-snapshot.mjs';
import { runFillForm } from './fill-form.mjs';
import { runScore } from './score.mjs';
import {
  formatResult as formatValidationResult,
  runValidation,
} from './validate.mjs';
import {
  readJson,
  relativePath,
  writeJson,
} from './scoring/io.mjs';
import { isFixtureId } from './shared.mjs';
import {
  DEFAULT_DOCUMENT_ORDER,
  DEFAULT_DOCUMENT_ORDER_SEED,
  buildPacketDocumentMetadata,
  loadPacketDocumentStats,
  orderPacketDocuments,
  validateDocumentOrder,
} from './packet-documents.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_GRAPHQL_URL = 'http://localhost:3000/graphql';
const DEFAULT_AGENT_TIMEOUT_MS = 900_000;
const DEFAULT_PROMPT_TEMPLATE = 'examples/eval/prompts/mcp-open-schema-packet.md';

export async function runMcpPacketE2E({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  pdfFieldReader,
  now = () => new Date(),
  runners = {},
} = {}) {
  const parsed = parseArgs(args, env, now);
  if (parsed.kind === 'help') return { exitCode: 0, lines: [usage()] };
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  const stageRunners = {
    validate: runValidation,
    setupOpenSchemaMemory: prepareOpenSchemaMemory,
    agent: runAgentProcess,
    exportMemorySnapshot: runExportMemorySnapshot,
    fillForm: runFillForm,
    score: runScore,
    ...runners,
  };
  const artifacts = buildPacketArtifacts({ repoRoot, options });
  const report = initialPacketReport({ repoRoot, options, artifacts, startedAt: isoTimestamp(now) });
  let setupResult = null;
  let activeFailureContext = {
    stage: 'initialize',
    scenarioId: null,
    artifacts: {},
  };

  const writeReport = async () => {
    await writeJson(artifacts.packetRun, report);
  };
  const setActiveStage = (stage, scenarioId = null, stageArtifacts = {}) => {
    activeFailureContext = { stage, scenarioId, artifacts: stageArtifacts };
  };

  try {
    setActiveStage('initialize');
    await mkdir(artifacts.artifactsRoot, { recursive: true });
    await writeReport();

    setActiveStage('validate-corpus', null, {
      validationReport: relativePath(repoRoot, artifacts.validationReport),
    });
    const corpusValidation = await stageRunners.validate({
      repoRoot,
      args: [
        '--user',
        options.userId,
        '--corpus',
        options.corpusId,
        '--documents-root',
        options.documentsRoot,
        '--report-out',
        artifacts.validationReport,
      ],
    });
    if (corpusValidation.exitCode !== 0) {
      throw packetStageError({
        stage: 'validate-corpus',
        result: {
          ...corpusValidation,
          lines: corpusValidation.lines ?? [formatValidationResult(corpusValidation)],
        },
        artifacts: activeFailureContext.artifacts,
        authToken: options.authToken,
      });
    }

    for (const scenarioId of options.scenarioIds) {
      setActiveStage('validate-scenario', scenarioId);
      const scenarioValidation = await stageRunners.validate({
        repoRoot,
        args: ['--scenario', scenarioId],
      });
      if (scenarioValidation.exitCode !== 0) {
        throw packetStageError({
          stage: 'validate-scenario',
          scenarioId,
          result: {
            ...scenarioValidation,
            lines: scenarioValidation.lines ?? [formatValidationResult(scenarioValidation)],
          },
          authToken: options.authToken,
        });
      }
    }

    setActiveStage('setup-open-schema-memory');
    setupResult = await stageRunners.setupOpenSchemaMemory({
      repoRoot,
      evalUserId: options.userId,
      corpusId: options.corpusId,
      documentsRoot: options.documentsRoot,
      graphqlUrl: options.graphqlUrl,
      authToken: options.authToken,
      resetMemoryEnabled: options.resetMemory,
      resetMemoryMode: options.resetMemoryMode ?? 'MEMORY_ONLY',
      ensureDefinitionsEnabled: false,
      fetchImpl,
    });
    report.backendUserId = setupResult.backendUserId ?? null;
    report.summaries.setup = setupSummary(setupResult, options);
    await writeReport();

    setActiveStage('export-definition-baseline', null, {
      definitionBaseline: relativePath(repoRoot, artifacts.definitionBaseline),
      memorySnapshotBeforeAgent: relativePath(repoRoot, artifacts.memorySnapshotBeforeAgent),
    });
    const definitionBaseline = await stageRunners.exportMemorySnapshot({
      repoRoot,
      args: exportMemorySnapshotArgs({
        options,
        outPath: artifacts.memorySnapshotBeforeAgent,
        baselineOut: artifacts.definitionBaseline,
      }),
      env: {},
      fetchImpl,
      now,
    });
    if (definitionBaseline.exitCode !== 0) {
      throw packetStageError({
        stage: 'export-definition-baseline',
        result: {
          ...definitionBaseline,
          lines: definitionBaseline.lines ?? [formatExportMemorySnapshotResult(definitionBaseline)],
        },
        artifacts: activeFailureContext.artifacts,
        authToken: options.authToken,
      });
    }

    const orderedDocuments = orderPacketDocuments(
      setupResult.fixture?.manifest?.documents ?? [],
      options,
    );
    const documentStats = await loadPacketDocumentStats({
      documentsRoot: path.resolve(
        repoRoot,
        setupResult.fixture?.documentsRoot ?? options.documentsRoot,
      ),
      documents: orderedDocuments,
    });
    report.documents = buildPacketDocumentMetadata({
      documents: orderedDocuments,
      documentOrder: options.documentOrder,
      documentOrderSeed: options.documentOrderSeed,
      sourceCharCount: documentStats.sourceCharCount,
    });
    await writeReport();

    setActiveStage('prepare-agent-workspace');
    const workspace = await prepareAgentWorkspace({
      repoRoot,
      artifacts,
      options,
      fixture: setupResult.fixture,
      documents: orderedDocuments,
    });
    setActiveStage('build-agent-prompt', null, {
      prompt: relativePath(repoRoot, artifacts.prompt),
    });
    const prompt = await buildPacketMcpAgentPrompt({
      repoRoot,
      options,
      fixture: setupResult.fixture,
      agentWorkspace: workspace,
      documents: orderedDocuments,
    });
    await writeText(artifacts.prompt, prompt);
    await writeClaudeSettings({ artifacts, options });

    setActiveStage('run-mcp-agent', null, {
      transcript: relativePath(repoRoot, artifacts.transcript),
    });
    const agentResult = await stageRunners.agent({
      repoRoot,
      options,
      prompt,
      artifacts,
      env,
      now,
    });
    await writeText(artifacts.transcript, packetTranscript({ repoRoot, options, artifacts, agentResult }));
    if (agentResult.exitCode !== 0 || agentResult.timedOut || !agentResult.completionMarkerObserved) {
      throw packetStageError({
        stage: 'run-mcp-agent',
        result: {
          exitCode: Number.isInteger(agentResult.exitCode) ? agentResult.exitCode : 1,
          lines: [
            'packet MCP agent failed',
            ...(agentResult.lines ?? []),
            `transcript=${relativePath(repoRoot, artifacts.transcript)}`,
          ],
        },
        artifacts: activeFailureContext.artifacts,
        authToken: options.authToken,
      });
    }
    report.summaries.agent = {
      exitCode: agentResult.exitCode,
      timedOut: Boolean(agentResult.timedOut),
      completionMarkerObserved: Boolean(agentResult.completionMarkerObserved),
      transcript: relativePath(repoRoot, artifacts.transcript),
    };
    await writeReport();

    setActiveStage('export-memory-snapshot', null, {
      memorySnapshot: relativePath(repoRoot, artifacts.memorySnapshot),
    });
    const exportResult = await stageRunners.exportMemorySnapshot({
      repoRoot,
      args: exportMemorySnapshotArgs({
        options,
        outPath: artifacts.memorySnapshot,
        baselineIn: artifacts.definitionBaseline,
      }),
      env: {},
      fetchImpl,
      now,
    });
    if (exportResult.exitCode !== 0) {
      throw packetStageError({
        stage: 'export-memory-snapshot',
        result: {
          ...exportResult,
          lines: exportResult.lines ?? [formatExportMemorySnapshotResult(exportResult)],
        },
        artifacts: activeFailureContext.artifacts,
        authToken: options.authToken,
      });
    }

    setActiveStage('score-open-schema-database', null, {
      openSchemaDatabaseScoreReport: relativePath(
        repoRoot,
        artifacts.openSchemaDatabaseScoreReport,
      ),
    });
    const databaseScore = await stageRunners.score({
      repoRoot,
      args: [
        '--mode',
        'open-schema-database',
        '--user',
        options.userId,
        '--corpus',
        options.corpusId,
        '--memory-snapshot',
        artifacts.memorySnapshot,
        '--validation-report',
        artifacts.validationReport,
        '--out',
        artifacts.openSchemaDatabaseScoreReport,
      ],
    });
    if (databaseScore.exitCode !== 0) {
      throw packetStageError({
        stage: 'score-open-schema-database',
        result: databaseScore,
        fallbackMessage: 'open-schema database score failed',
        artifacts: activeFailureContext.artifacts,
        authToken: options.authToken,
      });
    }
    report.summaries.databaseScore =
      (await readJson(artifacts.openSchemaDatabaseScoreReport)).summary ?? null;
    report.qualitySummary = buildPacketQualitySummary(report);
    await writeReport();

    for (const scenarioId of options.scenarioIds) {
      const scenarioArtifacts = artifacts.scenarios[scenarioId];
      await mkdir(scenarioArtifacts.root, { recursive: true });
      const scenarioArtifactPaths = {
        filledForm: relativePath(repoRoot, scenarioArtifacts.filledForm),
        filledPdf: relativePath(repoRoot, scenarioArtifacts.filledPdf),
        formFillResponse: relativePath(repoRoot, scenarioArtifacts.formFillResponse),
        formScoreReport: relativePath(repoRoot, scenarioArtifacts.formScoreReport),
        openSchemaCombinedScoreReport: relativePath(
          repoRoot,
          scenarioArtifacts.openSchemaCombinedScoreReport,
        ),
      };
      setActiveStage('fill-form', scenarioId, scenarioArtifactPaths);
      const fillResult = await stageRunners.fillForm({
        repoRoot,
        args: [
          '--scenario',
          scenarioId,
          '--out',
          scenarioArtifacts.filledForm,
          '--backend-url',
          options.backendUrl,
          '--auth-token',
          options.authToken,
          '--filled-pdf-out',
          scenarioArtifacts.filledPdf,
          '--response-out',
          scenarioArtifacts.formFillResponse,
        ],
        env: {},
        fetchImpl,
        ...(pdfFieldReader ? { pdfFieldReader } : {}),
      });
      if (fillResult.exitCode !== 0) {
        throw packetStageError({
          stage: 'fill-form',
          scenarioId,
          result: fillResult,
          fallbackMessage: `form fill failed: ${scenarioId}`,
          artifacts: scenarioArtifactPaths,
          authToken: options.authToken,
        });
      }

      setActiveStage('score-form', scenarioId, scenarioArtifactPaths);
      const formScore = await stageRunners.score({
        repoRoot,
        args: [
          '--mode',
          'form',
          '--scenario',
          scenarioId,
          '--filled-form',
          scenarioArtifacts.filledForm,
          '--out',
          scenarioArtifacts.formScoreReport,
        ],
      });
      if (formScore.exitCode !== 0) {
        throw packetStageError({
          stage: 'score-form',
          scenarioId,
          result: formScore,
          fallbackMessage: `form score failed: ${scenarioId}`,
          artifacts: scenarioArtifactPaths,
          authToken: options.authToken,
        });
      }

      setActiveStage('score-open-schema-combined', scenarioId, scenarioArtifactPaths);
      const combinedScore = await stageRunners.score({
        repoRoot,
        args: [
          '--mode',
          'open-schema-combined',
          '--open-schema-database-report',
          artifacts.openSchemaDatabaseScoreReport,
          '--form-report',
          scenarioArtifacts.formScoreReport,
          '--out',
          scenarioArtifacts.openSchemaCombinedScoreReport,
        ],
      });
      if (combinedScore.exitCode !== 0) {
        throw packetStageError({
          stage: 'score-open-schema-combined',
          scenarioId,
          result: combinedScore,
          fallbackMessage: `combined score failed: ${scenarioId}`,
          artifacts: scenarioArtifactPaths,
          authToken: options.authToken,
        });
      }

      report.scenarios[scenarioId] = {
        filledForm: relativePath(repoRoot, scenarioArtifacts.filledForm),
        filledPdf: relativePath(repoRoot, scenarioArtifacts.filledPdf),
        formFillResponse: relativePath(repoRoot, scenarioArtifacts.formFillResponse),
        formScoreReport: relativePath(repoRoot, scenarioArtifacts.formScoreReport),
        openSchemaCombinedScoreReport: relativePath(
          repoRoot,
          scenarioArtifacts.openSchemaCombinedScoreReport,
        ),
        formScoreSummary: (await readJson(scenarioArtifacts.formScoreReport)).summary ?? null,
        combinedScoreSummary:
          (await readJson(scenarioArtifacts.openSchemaCombinedScoreReport)).summary ?? null,
      };
      report.qualitySummary = buildPacketQualitySummary(report);
      await writeReport();
    }

    report.status = 'pass';
    report.endedAt = isoTimestamp(now);
    report.qualitySummary = buildPacketQualitySummary(report);
    await writeReport();
    return {
      exitCode: 0,
      lines: [
        'eval e2e-mcp-packet passed',
        `scenarios=${options.scenarioIds.length}`,
        `memory-score=${relativePath(repoRoot, artifacts.openSchemaDatabaseScoreReport)}`,
        `packet-run=${relativePath(repoRoot, artifacts.packetRun)}`,
      ],
      report,
    };
  } catch (error) {
    report.status = 'fail';
    report.endedAt = isoTimestamp(now);
    const failure = failureFromError({
      error,
      activeFailureContext,
      options,
    });
    failure.scoredScenarioIds = Object.keys(report.scenarios ?? {});
    failure.notScoredScenarioIds = options.scenarioIds.filter(
      (scenarioId) => !Object.hasOwn(report.scenarios ?? {}, scenarioId),
    );
    report.failureStage = failure.stage;
    report.failureKind = failure.kind;
    report.failure = failure;
    report.error = failure.message;
    report.qualitySummary = buildPacketQualitySummary(report);
    await writeReport().catch(() => {});
    return {
      exitCode: 1,
      lines: failureLines({ repoRoot, artifacts, report, failure }),
      error,
      report,
    };
  }
}

export function parseArgs(args, env = process.env, now = () => new Date()) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    backendUrl: env.EVAL_BACKEND_URL || DEFAULT_BACKEND_URL,
    graphqlUrl: env.EVAL_GRAPHQL_URL || DEFAULT_GRAPHQL_URL,
    authToken: env.EVAL_AUTH_TOKEN,
    model: env.EVAL_MODEL,
    modelSource: env.EVAL_MODEL ? 'env' : 'unspecified',
    modelLabel: env.EVAL_MODEL_LABEL,
    modelLabelSource: env.EVAL_MODEL_LABEL ? 'env' : 'unspecified',
    thinkingMode: null,
    thinkingSource: 'unspecified',
    resetMemory: false,
    resetMemoryMode: null,
    allowTestCommandAgent: false,
    agentTimeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    documentOrder: DEFAULT_DOCUMENT_ORDER,
    documentOrderSeed: DEFAULT_DOCUMENT_ORDER_SEED,
  };
  const valueArgs = new Set([
    '--agent',
    '--schema-mode',
    '--form-mode',
    '--user',
    '--corpus',
    '--scenarios',
    '--artifacts-root',
    '--mcp-server',
    '--documents-root',
    '--backend-url',
    '--graphql-url',
    '--auth-token',
    '--agent-command',
    '--agent-timeout-ms',
    '--prompt-template',
    '--mcp-config',
    '--model',
    '--model-label',
    '--thinking-mode',
    '--document-order',
    '--document-order-seed',
    '--location-id',
    '--run-id',
  ]);
  const dashPrefixedValueArgs = new Set(['--agent-command', '--model-label', '--run-id']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--reset-memory') {
      if (options.resetMemoryMode === 'DEMO_DATA') {
        return {
          kind: 'usage-error',
          message: '--reset-memory and --reset-demo-data are mutually exclusive',
        };
      }
      options.resetMemory = true;
      options.resetMemoryMode = 'MEMORY_ONLY';
      continue;
    }
    if (arg === '--reset-demo-data') {
      if (options.resetMemoryMode === 'MEMORY_ONLY') {
        return {
          kind: 'usage-error',
          message: '--reset-memory and --reset-demo-data are mutually exclusive',
        };
      }
      options.resetMemory = true;
      options.resetMemoryMode = 'DEMO_DATA';
      continue;
    }
    if (arg === '--allow-test-command-agent') {
      options.allowTestCommandAgent = true;
      continue;
    }
    if (!valueArgs.has(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }
    const value = args[index + 1];
    if (!value || (value.startsWith('--') && !dashPrefixedValueArgs.has(arg))) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--agent') options.agent = value;
    if (arg === '--schema-mode') options.schemaMode = value;
    if (arg === '--form-mode') options.formMode = value;
    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--scenarios') options.scenarioIds = value.split(',').filter(Boolean);
    if (arg === '--artifacts-root') options.artifactsRoot = value;
    if (arg === '--mcp-server') options.mcpServer = value;
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--backend-url') options.backendUrl = value;
    if (arg === '--graphql-url') options.graphqlUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--agent-command') options.agentCommand = value;
    if (arg === '--agent-timeout-ms') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { kind: 'usage-error', message: '--agent-timeout-ms must be a positive integer.' };
      }
      options.agentTimeoutMs = parsed;
    }
    if (arg === '--prompt-template') options.promptTemplate = value;
    if (arg === '--mcp-config') options.mcpConfig = value;
    if (arg === '--model') {
      options.model = value;
      options.modelSource = 'manual';
    }
    if (arg === '--model-label') {
      options.modelLabel = value;
      options.modelLabelSource = 'manual';
    }
    if (arg === '--thinking-mode') {
      options.thinkingMode = value;
      options.thinkingSource = 'manual';
    }
    if (arg === '--document-order') options.documentOrder = value;
    if (arg === '--document-order-seed') options.documentOrderSeed = value;
    if (arg === '--location-id') options.locationId = value;
    if (arg === '--run-id') options.runId = value;
  }

  for (const [key, flag] of [
    ['agent', '--agent'],
    ['schemaMode', '--schema-mode'],
    ['formMode', '--form-mode'],
    ['userId', '--user'],
    ['corpusId', '--corpus'],
    ['scenarioIds', '--scenarios'],
    ['artifactsRoot', '--artifacts-root'],
    ['mcpServer', '--mcp-server'],
  ]) {
    if (!options[key] || (Array.isArray(options[key]) && options[key].length === 0)) {
      return { kind: 'usage-error', message: `Missing required ${flag}` };
    }
  }
  if (!['claude', 'command'].includes(options.agent)) {
    return { kind: 'usage-error', message: 'Expected --agent claude or --agent command' };
  }
  if (options.agent === 'command' && !options.agentCommand) {
    return {
      kind: 'usage-error',
      message: 'Missing required --agent-command when --agent command is used',
    };
  }
  if (options.agent === 'command' && !options.allowTestCommandAgent) {
    return {
      kind: 'usage-error',
      message: '--agent command is a deterministic test adapter; pass --allow-test-command-agent to use it',
    };
  }
  if (options.agent === 'claude' && !options.mcpConfig) {
    return { kind: 'usage-error', message: 'Missing required --mcp-config when --agent claude is used' };
  }
  if (options.schemaMode !== 'open') {
    return { kind: 'usage-error', message: 'Expected --schema-mode open' };
  }
  if (options.formMode !== 'backend') {
    return { kind: 'usage-error', message: 'Expected --form-mode backend' };
  }
  if (!options.authToken) {
    return { kind: 'usage-error', message: 'Missing required --auth-token or EVAL_AUTH_TOKEN' };
  }
  if (options.agent === 'claude') {
    if (options.thinkingSource !== 'manual') {
      options.thinkingMode = env.EVAL_THINKING_MODE || 'default';
      options.thinkingSource = env.EVAL_THINKING_MODE ? 'env' : 'default';
    }
    const thinkingError = validateThinkingMode(options.thinkingMode);
    if (thinkingError) {
      return { kind: 'usage-error', message: thinkingError };
    }
  } else {
    if (options.thinkingSource === 'manual') {
      return { kind: 'usage-error', message: '--thinking-mode is only supported with --agent claude.' };
    }
    options.thinkingMode = 'default';
    options.thinkingSource = 'default';
  }
  for (const [label, value] of [
    ['--user', options.userId],
    ['--corpus', options.corpusId],
    ...options.scenarioIds.map((scenarioId) => ['--scenarios', scenarioId]),
  ]) {
    if (!isFixtureId(value)) {
      return { kind: 'usage-error', message: `${label} must contain fixture ids.` };
    }
  }
  const documentOrderError = validateDocumentOrder(options);
  if (documentOrderError) {
    return { kind: 'usage-error', message: documentOrderError };
  }
  if (!options.documentOrderSeed) {
    return { kind: 'usage-error', message: '--document-order-seed must be a non-empty string.' };
  }

  options.documentsRoot =
    options.documentsRoot ??
    path.join('examples/eval/users', options.userId, 'corpora', options.corpusId);
  options.packetScenarioId = `${options.corpusId}-packet`;
  options.runId = options.runId ?? generatedRunId(options, now);
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:e2e-mcp-packet --agent claude|command --schema-mode open --form-mode backend --user <userId> --corpus <corpusId> --scenarios <scenarioId,...> --artifacts-root <dir> --mcp-server <name> [options]',
    '',
    'Notes:',
    '  Runs one MCP open-schema ingestion over a packet corpus, then fills multiple forms from the same memory.',
    '  v1 supports open schema with backend form fill only.',
    '',
    'Options:',
    '  --documents-root <dir>            Defaults to examples/eval/users/<user>/corpora/<corpus>',
    '  --backend-url <url>               Defaults to EVAL_BACKEND_URL or http://localhost:3000',
    '  --graphql-url <url>               Defaults to EVAL_GRAPHQL_URL or http://localhost:3000/graphql',
    '  --auth-token <token>              Defaults to EVAL_AUTH_TOKEN',
    '  --agent-command <command>         Required with --agent command; prompt is passed on stdin',
    '  --allow-test-command-agent        Required with --agent command; marks the command adapter as test-only',
    '  --mcp-config <path>               Required with --agent claude; loaded with --strict-mcp-config',
    '  --agent-timeout-ms <ms>           Defaults to 900000',
    '  --prompt-template <path>          Defaults to examples/eval/prompts/mcp-open-schema-packet.md',
    '  --model <model>                   Defaults to EVAL_MODEL; passed to Claude Code when --agent claude',
    '  --model-label <label>             Defaults to EVAL_MODEL_LABEL; metadata-only fallback',
    '  --thinking-mode <mode>            Claude Code only: default|low|medium|high|xhigh|max',
    '  --document-order <mode>           canonical|reverse|seeded-random|relevant-first|relevant-last',
    `  --document-order-seed <seed>      Defaults to ${DEFAULT_DOCUMENT_ORDER_SEED}`,
    '  --reset-memory                    Clear current backend user memory values before the agent run',
    '  --reset-demo-data                 Clear current backend user demo data, including user-owned definitions',
    '  --location-id <locationId>         Export merged global + location view',
    '  --run-id <id>',
  ].join('\n');
}

export async function buildPacketMcpAgentPrompt({
  repoRoot = defaultRepoRoot,
  options,
  fixture,
  agentWorkspace,
  documents = null,
}) {
  const loadedFixture =
    fixture ??
    (await loadKnownSchemaFixture({
      repoRoot,
      evalUserId: options.userId,
      corpusId: options.corpusId,
      documentsRoot: options.documentsRoot,
    }));
  const scenarios = [];
  for (const scenarioId of options.scenarioIds) {
    const scenarioRoot = path.join(repoRoot, 'examples/eval/scenarios', scenarioId);
    const scenario = await readJson(path.join(scenarioRoot, 'scenario.json'));
    const scenarioPrompt = (await readFile(path.join(scenarioRoot, 'start/prompt.md'), 'utf8')).trim();
    scenarios.push({ scenario, prompt: scenarioPrompt });
  }
  const templatePath = path.resolve(repoRoot, options.promptTemplate);
  const template = await readFile(templatePath, 'utf8');
  const promptDocuments = documents ?? orderPacketDocuments(
    loadedFixture.manifest.documents ?? [],
    options,
  );
  return renderTemplate(template, {
    MCP_SERVER: options.mcpServer,
    USER_ID: options.userId,
    CORPUS_ID: options.corpusId,
    SCENARIO_LIST: scenarioList(scenarios),
    DOCUMENTS_ROOT: agentWorkspace
      ? displayPath(repoRoot, agentWorkspace.root)
      : displayPath(repoRoot, path.resolve(repoRoot, options.documentsRoot)),
    DOCUMENT_LIST: documentList(promptDocuments),
    COMPLETION_MARKER,
  });
}

function buildPacketArtifacts({ repoRoot, options }) {
  const artifactsRoot = path.resolve(repoRoot, options.artifactsRoot);
  const agentWorkspaceRoot = path.join(artifactsRoot, 'agent-workspace');
  const scenarios = Object.fromEntries(
    options.scenarioIds.map((scenarioId) => {
      const root = path.join(artifactsRoot, 'scenarios', scenarioId);
      return [
        scenarioId,
        {
          root,
          filledForm: path.join(root, 'filled-form.json'),
          filledPdf: path.join(root, 'filled-form.pdf'),
          formFillResponse: path.join(root, 'form-fill-response.json'),
          formScoreReport: path.join(root, 'form-score-report.json'),
          openSchemaCombinedScoreReport: path.join(root, 'open-schema-combined-score-report.json'),
        },
      ];
    }),
  );
  return {
    artifactsRoot,
    packetRun: path.join(artifactsRoot, 'packet-evaluation-run.json'),
    agentWorkspaceRoot,
    safeDocumentIndex: path.join(agentWorkspaceRoot, 'documents.json'),
    agentInstructions: path.join(agentWorkspaceRoot, 'CLAUDE.md'),
    agentCodexInstructions: path.join(agentWorkspaceRoot, 'AGENTS.md'),
    claudeSettings: path.join(artifactsRoot, 'claude-settings.json'),
    validationReport: path.join(artifactsRoot, 'validation-report.json'),
    prompt: path.join(artifactsRoot, 'mcp-agent-prompt.md'),
    transcript: path.join(artifactsRoot, 'mcp-agent-transcript.txt'),
    definitionBaseline: path.join(artifactsRoot, 'definition-baseline.json'),
    memorySnapshotBeforeAgent: path.join(artifactsRoot, 'memory-snapshot-before-agent.json'),
    memorySnapshot: path.join(artifactsRoot, 'memory-snapshot.json'),
    openSchemaDatabaseScoreReport: path.join(artifactsRoot, 'open-schema-database-score-report.json'),
    scenarios,
  };
}

function initialPacketReport({ repoRoot, options, artifacts, startedAt }) {
  return {
    schemaVersion: 1,
    artifactType: 'mcp-packet-evaluation-run',
    evaluationMode: MCP_OPEN_SCHEMA_EVALUATION_MODE,
    status: 'running',
    runId: options.runId,
    userId: options.userId,
    corpusId: options.corpusId,
    scenarioIds: options.scenarioIds,
    documentsRoot: displayPath(repoRoot, path.resolve(repoRoot, options.documentsRoot)),
    artifactsRoot: relativePath(repoRoot, artifacts.artifactsRoot),
    agent: options.agent,
    model: modelMetadata({
      model: options.model,
      modelLabel: options.modelLabel,
      modelSource: options.modelSource,
      modelLabelSource: options.modelLabelSource,
    }),
    thinking: mcpThinkingMetadata(options),
    backendUserId: null,
    settings: {
      resetMemory: options.resetMemory,
      resetMode: options.resetMemoryMode,
      schemaMode: options.schemaMode,
      formMode: options.formMode,
      agent: options.agent,
      mcpServer: options.mcpServer,
      agentTimeoutMs: options.agentTimeoutMs,
      promptTemplate: displayPath(repoRoot, path.resolve(repoRoot, options.promptTemplate)),
      documentOrder: options.documentOrder,
      documentOrderSeed: options.documentOrderSeed,
    },
    documents: buildPacketDocumentMetadata({
      documents: [],
      documentOrder: options.documentOrder,
      documentOrderSeed: options.documentOrderSeed,
    }),
    artifacts: {
      prompt: relativePath(repoRoot, artifacts.prompt),
      transcript: relativePath(repoRoot, artifacts.transcript),
      validationReport: relativePath(repoRoot, artifacts.validationReport),
      definitionBaseline: relativePath(repoRoot, artifacts.definitionBaseline),
      memorySnapshot: relativePath(repoRoot, artifacts.memorySnapshot),
      openSchemaDatabaseScoreReport: relativePath(
        repoRoot,
        artifacts.openSchemaDatabaseScoreReport,
      ),
    },
    summaries: {
      setup: null,
      agent: null,
      databaseScore: null,
    },
    qualitySummary: null,
    scenarios: {},
    startedAt,
    endedAt: null,
    failureStage: null,
    failureKind: null,
    failure: null,
    error: null,
  };
}

function exportMemorySnapshotArgs({ options, outPath, baselineOut, baselineIn }) {
  const args = [
    '--user',
    options.userId,
    '--corpus',
    options.corpusId,
    '--scenario',
    options.packetScenarioId,
    '--out',
    outPath,
    '--graphql-url',
    options.graphqlUrl,
    '--auth-token',
    options.authToken,
    '--include-suggestions',
    '--producer',
    MCP_OPEN_SCHEMA_PRODUCER,
    '--schema-mode',
    'open',
    '--schema-reset-mode',
    OPEN_SCHEMA_BASELINE_RESET_MODE,
    '--run-id',
    options.runId,
  ];
  if (baselineOut) args.push('--baseline-out', baselineOut);
  if (baselineIn) args.push('--baseline-in', baselineIn);
  if (options.locationId) args.push('--location-id', options.locationId);
  return args;
}

function setupSummary(setupResult, options) {
  const definitionSetup = setupResult?.definitionSetup ?? {};
  return {
    backendUserId: setupResult?.backendUserId ?? null,
    resetMemory: options.resetMemory,
    resetMode: options.resetMemoryMode,
    createdDefinitionCount: definitionSetup.created?.length ?? 0,
    existingDefinitionCount: definitionSetup.existing?.length ?? 0,
    skippedDefinitionCount: definitionSetup.skipped?.length ?? 0,
  };
}

function buildPacketQualitySummary(report) {
  const databaseScore = report.summaries?.databaseScore ?? {};
  const scenarioEntries = Object.entries(report.scenarios ?? {});
  const formSummaries = scenarioEntries
    .map(([, scenario]) => scenario.formScoreSummary)
    .filter(Boolean);

  const knownFieldCorrectTotal = sumNumbers(formSummaries, 'knownFieldCorrect');
  const knownFieldTotal = sumNumbers(formSummaries, 'knownFieldTotal');
  const knownFieldWrong = sumNumbers(formSummaries, 'knownFieldWrong');
  const knownFieldMissing = sumNumbers(formSummaries, 'knownFieldMissing');
  const abstentionFieldAbsentCorrect = sumNumbers(formSummaries, 'abstentionFieldAbsentCorrect');
  const abstentionFieldTotal = sumNumbers(formSummaries, 'abstentionFieldTotal');
  const abstentionFieldHallucinated = sumNumbers(formSummaries, 'abstentionFieldHallucinated');
  const overfillCount = sumNumbers(formSummaries, 'structuralOverfillCount')
    + sumNumbers(formSummaries, 'manualAttestationOverfillCount')
    + sumNumbers(formSummaries, 'outOfScopeOverfillCount')
    + sumNumbers(formSummaries, 'unmappedOverfillCount');
  const formAccuracies = formSummaries
    .map((summary) => summary.knownFieldAccuracy)
    .filter((value) => typeof value === 'number');

  return {
    memoryKnownRecovered: ratioString(
      databaseScore.knownPresentRecoveredActive,
      databaseScore.knownPresentTotal,
    ),
    memoryMissingAbsent: ratioString(
      databaseScore.missingAbsentCorrect,
      databaseScore.intentionallyMissingTotal,
    ),
    memoryActiveValueRecoveryRate:
      typeof databaseScore.activeValueRecoveryRate === 'number'
        ? databaseScore.activeValueRecoveryRate
        : null,
    memoryOwnershipClean: `${databaseScore.ownershipDecoyClean ?? 0}/${databaseScore.ownershipDecoyTotal ?? 0}`,
    memoryOwnershipForbiddenLeaks:
      (databaseScore.ownershipDecoyForbiddenActiveLeak ?? 0)
      + (databaseScore.ownershipDecoyForbiddenSuggestionLeak ?? 0),
    knownFieldCorrect: ratioString(knownFieldCorrectTotal, knownFieldTotal),
    knownFieldWrong,
    knownFieldMissing,
    knownFieldAccuracy: ratioNumber(knownFieldCorrectTotal, knownFieldTotal),
    averagePerFormAccuracy: formAccuracies.length
      ? roundMetric(formAccuracies.reduce((total, value) => total + value, 0) / formAccuracies.length)
      : null,
    abstentionAbsentCorrect: ratioString(abstentionFieldAbsentCorrect, abstentionFieldTotal),
    abstentionFieldHallucinated,
    overfillCount,
    perScenario: Object.fromEntries(
      scenarioEntries.map(([scenarioId, scenario]) => [
        scenarioId,
        scenarioQualitySummary(scenario.formScoreSummary),
      ]),
    ),
  };
}

function scenarioQualitySummary(formScoreSummary) {
  if (!formScoreSummary) return null;
  return {
    knownFieldCorrect: ratioString(
      formScoreSummary.knownFieldCorrect,
      formScoreSummary.knownFieldTotal,
    ),
    knownFieldWrong: numberOrNull(formScoreSummary.knownFieldWrong),
    knownFieldMissing: numberOrNull(formScoreSummary.knownFieldMissing),
    knownFieldAccuracy: numberOrNull(formScoreSummary.knownFieldAccuracy),
    abstentionAbsentCorrect: ratioString(
      formScoreSummary.abstentionFieldAbsentCorrect,
      formScoreSummary.abstentionFieldTotal,
    ),
    abstentionFieldHallucinated: numberOrNull(formScoreSummary.abstentionFieldHallucinated),
    overfillCount: numberOrNull(formScoreSummary.structuralOverfillCount)
      + numberOrNull(formScoreSummary.manualAttestationOverfillCount)
      + numberOrNull(formScoreSummary.outOfScopeOverfillCount)
      + numberOrNull(formScoreSummary.unmappedOverfillCount),
  };
}

class PacketStageError extends Error {
  constructor(failure) {
    super(failure.message);
    this.name = 'PacketStageError';
    this.failure = failure;
  }
}

function packetStageError({
  stage,
  scenarioId = null,
  result,
  fallbackMessage,
  artifacts = {},
  authToken,
}) {
  const lines = Array.isArray(result?.lines) ? result.lines : [];
  const message = lines.join('\n').trim() || fallbackMessage || `Stage ${stage} failed.`;
  return new PacketStageError(
    buildFailure({
      stage,
      scenarioId,
      kind: classifyFailureKind({ stage, message }),
      message,
      lines,
      artifacts,
      authToken,
    }),
  );
}

function failureFromError({ error, activeFailureContext, options }) {
  if (error instanceof PacketStageError) return { ...error.failure };
  const message = error?.stack ?? error?.message ?? String(error);
  const stage = activeFailureContext?.stage ?? 'unknown';
  return buildFailure({
    stage,
    scenarioId: activeFailureContext?.scenarioId ?? null,
    kind: classifyFailureKind({ stage, message }),
    message,
    lines: [message],
    artifacts: activeFailureContext?.artifacts ?? {},
    authToken: options.authToken,
  });
}

function buildFailure({
  stage,
  scenarioId = null,
  kind,
  message,
  lines = [],
  artifacts = {},
  authToken,
}) {
  const redactedLines = redactLines(lines.length ? lines : [message], authToken)
    .map(compactLine)
    .filter(Boolean);
  const redactedMessage = compactMessage(
    redactSecret(message || redactedLines.join('\n') || `Stage ${stage} failed.`, authToken),
  );
  return {
    stage,
    scenarioId,
    kind,
    message: redactedMessage,
    lines: redactedLines,
    artifacts,
  };
}

function classifyFailureKind({ stage, message }) {
  const text = message || '';
  if (stage === 'fill-form') {
    if (/AI response failed validation|Zod validation failed|Invalid input/i.test(text)) {
      return 'form_fill_structured_output_validation';
    }
    if (/Form-fill response status was failed/i.test(text)) {
      return 'form_fill_backend_failed_status';
    }
    if (/Form-fill request failed with HTTP/i.test(text)) {
      return 'form_fill_http_error';
    }
    if (/not valid JSON|missing string field|missing summary|did not include|not supported/i.test(text)) {
      return 'form_fill_response_contract';
    }
    if (/PDF|parse|invalid/i.test(text)) return 'form_fill_pdf_read';
    return 'form_fill_failed';
  }
  if (stage === 'run-mcp-agent') return 'agent_failed';
  if (stage.startsWith('validate-')) return 'validation_failed';
  if (stage.startsWith('score-')) return 'score_failed';
  if (stage.startsWith('export-')) return 'memory_export_failed';
  if (stage === 'setup-open-schema-memory') return 'memory_setup_failed';
  return 'stage_failed';
}

function failureLines({ repoRoot, artifacts, report, failure }) {
  const lines = [
    'eval e2e-mcp-packet failed',
    `stage=${failure.stage}`,
    failure.scenarioId ? `scenario=${failure.scenarioId}` : null,
    `kind=${failure.kind}`,
    failure.artifacts?.formFillResponse
      ? `response=${failure.artifacts.formFillResponse}`
      : null,
    report.qualitySummary?.memoryKnownRecovered
      ? `memory-known=${report.qualitySummary.memoryKnownRecovered}`
      : null,
    report.qualitySummary?.knownFieldCorrect
      ? `known-fields-so-far=${report.qualitySummary.knownFieldCorrect}`
      : null,
    failure.notScoredScenarioIds?.length
      ? `not-scored-scenarios=${failure.notScoredScenarioIds.join(',')}`
      : null,
    `packet-run=${relativePath(repoRoot, artifacts.packetRun)}`,
    '',
    ...failure.lines,
  ];
  return lines.filter((line) => line !== null && line !== undefined && line !== '');
}

function redactLines(lines, secret) {
  return lines.map((line) => redactSecret(String(line), secret));
}

function redactSecret(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('[redacted-auth-token]');
}

function compactLine(value) {
  const line = value.replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, 1_000) : null;
}

function compactMessage(value) {
  const message = value.trim();
  return message ? message.slice(0, 6_000) : 'Packet evaluation failed.';
}

function sumNumbers(items, key) {
  return items.reduce((total, item) => total + numberOrNull(item?.[key]), 0);
}

function numberOrNull(value) {
  return typeof value === 'number' ? value : 0;
}

function ratioString(numerator, denominator) {
  if (typeof numerator !== 'number' || typeof denominator !== 'number') return null;
  if (denominator === 0) return null;
  return `${numerator}/${denominator}`;
}

function ratioNumber(numerator, denominator) {
  if (typeof numerator !== 'number' || typeof denominator !== 'number' || denominator === 0) {
    return null;
  }
  return roundMetric(numerator / denominator);
}

function roundMetric(value) {
  return Number(value.toFixed(3));
}

async function writeClaudeSettings({ artifacts, options }) {
  await writeJson(artifacts.claudeSettings, {
    permissions: {
      allow: ['Read', 'Glob', 'Grep', `mcp__${options.mcpServer}__*`],
    },
  });
}

function packetTranscript({ repoRoot, options, artifacts, agentResult }) {
  const command = buildAgentInvocation({ repoRoot, options, artifacts }).display;
  return [
    `$ ${command}`,
    typeof agentResult.stdout === 'string' ? `[stdout]\n${agentResult.stdout}` : null,
    typeof agentResult.stderr === 'string' ? `[stderr]\n${agentResult.stderr}` : null,
    typeof agentResult.transcript === 'string' ? agentResult.transcript : null,
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}

function renderTemplate(template, values) {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.split(`{{${key}}}`).join(String(value));
  }
  return rendered;
}

function scenarioList(entries) {
  if (!entries.length) return '- <no scenarios>';
  return entries
    .map(({ scenario, prompt }) =>
      [
        `- scenario id: ${scenario.scenarioId}`,
        `  form id: ${scenario.formId ?? '<unknown>'}`,
        scenario.description ? `  purpose: ${scenario.description}` : null,
        prompt ? `  prompt: ${prompt}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
}

function documentList(documents) {
  if (!documents.length) return '- <no documents>';
  return documents
    .map((doc) =>
      [
        `- path: ${doc.path}`,
        `  id: ${doc.id ?? ''}`,
        `  title: ${doc.title ?? ''}`,
        `  category: ${doc.category ?? ''}`,
        `  outputExtension: ${doc.outputExtension ?? ''}`,
      ].join('\n'),
    )
    .join('\n');
}

function displayPath(repoRoot, targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? targetPath
    : relative;
}

function generatedRunId(options, now) {
  const timestamp = isoTimestamp(now).replace(/[:.]/g, '-');
  return `mcp-open-schema-packet-${options.userId}-${options.corpusId}-${timestamp}`;
}

function isoTimestamp(now) {
  return now().toISOString();
}

async function writeText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runMcpPacketE2E({ args: process.argv.slice(2) });
  console.log(result.lines.join('\n'));
  process.exitCode = result.exitCode;
}
