#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MCP_KNOWN_SCHEMA_EVALUATION_MODE,
  MCP_KNOWN_SCHEMA_PRODUCER,
  MCP_OPEN_SCHEMA_EVALUATION_MODE,
  MCP_OPEN_SCHEMA_PRODUCER,
  OPEN_SCHEMA_BASELINE_RESET_MODE,
} from './eval-constants.mjs';
import { runExportMemorySnapshot } from './export-memory-snapshot.mjs';
import { runExportStoredPreferences } from './export-stored-preferences.mjs';
import { runFillForm } from './fill-form.mjs';
import {
  loadKnownSchemaFixture,
  prepareKnownSchemaMemory,
} from './ingestor/setup.mjs';
import { fetchMemorySnapshotGraphql } from './memory-snapshot/client.mjs';
import {
  buildDefinitionBaselineArtifact,
  normalizeDefinitionRows,
  sortDefinitionRows,
} from './memory-snapshot/mapper.mjs';
import { readJson, relativePath, validateWithSchema, writeJson } from './scoring/io.mjs';
import { runScore } from './score.mjs';
import { isFixtureId } from './shared.mjs';
import {
  formatResult as formatValidationResult,
  runValidation,
} from './validate.mjs';
import {
  buildClaudeCodeArgs,
  thinkingMetadata,
  validateThinkingMode,
} from './claude-code-cli.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_GRAPHQL_URL = 'http://localhost:3000/graphql';
const DEFAULT_AGENT_TIMEOUT_MS = 900_000;
const KNOWN_PROMPT_TEMPLATE = 'examples/eval/prompts/mcp-known-schema.md';
const OPEN_PROMPT_TEMPLATE = 'examples/eval/prompts/mcp-open-schema.md';
const CLAUDE_BUILTIN_TOOLS = 'Read,Glob,Grep,ToolSearch';
export const COMPLETION_MARKER = 'EVAL_MCP_AGENT_DONE';

const KNOWN_STAGE_NAMES = [
  'validate-documents',
  'setup-memory-and-schema',
  'run-mcp-agent',
  'export-stored-preferences',
  'score-database',
  'fill-form',
  'score-form',
  'score-combined',
];

const OPEN_STAGE_NAMES = [
  'validate-documents',
  'setup-open-schema-memory',
  'capture-definition-baseline',
  'run-mcp-agent',
  'export-memory-snapshot',
  'score-open-schema-database',
  'fill-form',
  'score-form',
  'score-open-schema-combined',
];

export async function runMcpAgentE2E({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  pdfFieldReader,
  now = () => new Date(),
  runners = {},
} = {}) {
  const parsed = parseArgs(args, env, now);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  const artifactRedactionSecrets = agentArtifactSecrets(
    options,
    buildAgentEnvironment(env),
  );
  const stageRunners = {
    validate: runValidation,
    setup: prepareKnownSchemaMemory,
    setupOpenSchemaMemory: prepareOpenSchemaMemory,
    captureDefinitionBaseline,
    agent: runAgentProcess,
    exportStoredPreferences: runExportStoredPreferences,
    exportMemorySnapshot: runExportMemorySnapshot,
    score: runScore,
    fillForm: runFillForm,
    ...runners,
  };
  const artifacts = buildArtifacts({ repoRoot, options });
  const report = initialReport({ repoRoot, options, artifacts, startedAt: isoTimestamp(now) });
  const reportPath = artifacts.evaluationRun;
  let setupResult = null;
  let agentRun = null;

  const writeReport = async () => {
    await validateWithSchema(
      repoRoot,
      'evaluation-run.schema.json',
      report,
      'evaluation run',
    );
    await writeJson(reportPath, report);
  };

  const writeAgentRun = async () => {
    if (!agentRun) return;
    await validateWithSchema(
      repoRoot,
      'mcp-agent-run.schema.json',
      agentRun,
      'MCP agent run',
    );
    await writeJson(artifacts.mcpAgentRun, agentRun);
  };

  try {
    await writeReport();

    const stages = [
      {
        name: 'validate-documents',
        runner: async () => {
          const result = await stageRunners.validate({
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
          return {
            ...result,
            lines: result.lines ?? [formatValidationResult(result)],
          };
        },
        afterSuccess: async () => {
          const validationReport = await readJson(artifacts.validationReport);
          report.summaries.validation = validationReport.summary ?? null;
        },
      },
      {
        name: options.schemaMode === 'open' ? 'setup-open-schema-memory' : 'setup-memory-and-schema',
        runner: async () => {
          const setupRunner =
            options.schemaMode === 'open'
              ? stageRunners.setupOpenSchemaMemory
              : stageRunners.setup;
          setupResult = await setupRunner({
            repoRoot,
            evalUserId: options.userId,
            corpusId: options.corpusId,
            documentsRoot: options.documentsRoot,
            graphqlUrl: options.graphqlUrl,
            authToken: options.authToken,
            resetMemoryEnabled: options.resetMemory,
            resetMemoryMode: options.resetMemoryMode ?? 'MEMORY_ONLY',
            ensureDefinitionsEnabled: options.ensureDefinitions,
            fetchImpl,
          });
          const definitionSetup = setupResult.definitionSetup ?? {};
          return {
            exitCode: 0,
            lines: [
              'eval MCP setup passed',
              `backendUser=${setupResult.backendUserId}`,
              `definitions created=${definitionSetup.created?.length ?? 0} existing=${definitionSetup.existing?.length ?? 0} skipped=${definitionSetup.skipped?.length ?? 0}`,
            ],
          };
        },
        afterSuccess: async () => {
          report.backendUserId = setupResult.backendUserId ?? report.backendUserId;
          report.summaries.setup = setupSummary(setupResult, options);
          agentRun = initialAgentRun({
            repoRoot,
            options,
            artifacts,
            setupResult,
            startedAt: isoTimestamp(now),
          });
          await writeAgentRun();
        },
      },
      ...(options.schemaMode === 'open'
        ? [
            {
              name: 'capture-definition-baseline',
              runner: () =>
                stageRunners.captureDefinitionBaseline({
                  repoRoot,
                  options,
                  artifacts,
                  setupResult,
                  fetchImpl,
                  now,
                }),
            },
          ]
        : []),
      {
        name: 'run-mcp-agent',
        runner: async () => {
          const result = await runMcpAgentStage({
            repoRoot,
            options,
            artifacts,
            setupResult,
            agentRun,
            stageRunners,
            env,
            redactionSecrets: artifactRedactionSecrets,
            now,
            writeAgentRun,
          });
          report.summaries.agent = result.agentSummary ?? null;
          return result;
        },
      },
      ...(options.schemaMode === 'open'
        ? [
            {
              name: 'export-memory-snapshot',
              runner: () =>
                stageRunners.exportMemorySnapshot({
                  repoRoot,
                  args: exportMemorySnapshotArgs(options, artifacts),
                  env: {},
                  fetchImpl,
                  now,
                }),
              afterSuccess: async () => {
                const memorySnapshot = await readJson(artifacts.memorySnapshot);
                report.backendUserId =
                  memorySnapshot.diagnostics?.backendUserId ?? report.backendUserId;
                report.summaries.export = {
                  activePreferenceCount: memorySnapshot.preferences?.length ?? 0,
                  suggestedPreferenceCount: memorySnapshot.suggestions?.length ?? 0,
                  definitionCount: memorySnapshot.definitions?.length ?? 0,
                  schemaResetMode: memorySnapshot.diagnostics?.schemaResetMode ?? null,
                };
              },
            },
            {
              name: 'score-open-schema-database',
              runner: () =>
                stageRunners.score({
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
                }),
              afterSuccess: async () => {
                const databaseScore = await readJson(artifacts.openSchemaDatabaseScoreReport);
                report.summaries.databaseScore = databaseScore.summary ?? null;
              },
            },
          ]
        : [
            {
              name: 'export-stored-preferences',
              runner: () =>
                stageRunners.exportStoredPreferences({
                  repoRoot,
                  args: exportArgs(options, artifacts),
                  env: {},
                  fetchImpl,
                  now,
                }),
              afterSuccess: async () => {
                const storedPreferences = await readJson(artifacts.storedPreferences);
                report.backendUserId =
                  storedPreferences.diagnostics?.backendUserId ?? report.backendUserId;
                report.summaries.export = {
                  activePreferenceCount: storedPreferences.preferences?.length ?? 0,
                  suggestedPreferenceCount: storedPreferences.suggestions?.length ?? 0,
                };
              },
            },
            {
              name: 'score-database',
              runner: () =>
                stageRunners.score({
                  repoRoot,
                  args: [
                    '--mode',
                    'database',
                    '--user',
                    options.userId,
                    '--corpus',
                    options.corpusId,
                    '--stored-preferences',
                    artifacts.storedPreferences,
                    '--validation-report',
                    artifacts.validationReport,
                    '--out',
                    artifacts.databaseScoreReport,
                  ],
                }),
              afterSuccess: async () => {
                const databaseScore = await readJson(artifacts.databaseScoreReport);
                report.summaries.databaseScore = databaseScore.summary ?? null;
              },
            },
          ]),
      {
        name: 'fill-form',
        runner: () =>
          stageRunners.fillForm({
            repoRoot,
            args: [
              '--scenario',
              options.scenarioId,
              '--out',
              artifacts.filledForm,
              '--backend-url',
              options.backendUrl,
              '--auth-token',
              options.authToken,
              '--filled-pdf-out',
              artifacts.filledPdf,
              '--response-out',
              artifacts.formFillResponse,
            ],
            env: {},
            fetchImpl,
            ...(pdfFieldReader ? { pdfFieldReader } : {}),
          }),
        afterSuccess: async () => {
          const filledForm = await readJson(artifacts.filledForm);
          report.summaries.formFill = {
            status: filledForm.response?.status ?? null,
            fieldCount: filledForm.fields?.length ?? 0,
          };
        },
      },
      {
        name: 'score-form',
        runner: () =>
          stageRunners.score({
            repoRoot,
            args: [
              '--mode',
              'form',
              '--scenario',
              options.scenarioId,
              '--filled-form',
              artifacts.filledForm,
              '--out',
              artifacts.formScoreReport,
            ],
          }),
        afterSuccess: async () => {
          const formScore = await readJson(artifacts.formScoreReport);
          report.summaries.formScore = formScore.summary ?? null;
        },
      },
      ...(options.schemaMode === 'open'
        ? [
            {
              name: 'score-open-schema-combined',
              runner: () =>
                stageRunners.score({
                  repoRoot,
                  args: [
                    '--mode',
                    'open-schema-combined',
                    '--open-schema-database-report',
                    artifacts.openSchemaDatabaseScoreReport,
                    '--form-report',
                    artifacts.formScoreReport,
                    '--out',
                    artifacts.openSchemaCombinedScoreReport,
                  ],
                }),
              afterSuccess: async () => {
                const combinedScore = await readJson(artifacts.openSchemaCombinedScoreReport);
                report.summaries.combinedScore = combinedScore.summary ?? null;
              },
            },
          ]
        : [
            {
              name: 'score-combined',
              runner: () =>
                stageRunners.score({
                  repoRoot,
                  args: [
                    '--mode',
                    'combined',
                    '--database-report',
                    artifacts.databaseScoreReport,
                    '--form-report',
                    artifacts.formScoreReport,
                    '--out',
                    artifacts.combinedScoreReport,
                  ],
                }),
              afterSuccess: async () => {
                const combinedScore = await readJson(artifacts.combinedScoreReport);
                report.summaries.combinedScore = combinedScore.summary ?? null;
              },
            },
          ]),
    ];

    for (const stage of stages) {
      const result = await runStage({
        stage,
        report,
        redactionSecrets: artifactRedactionSecrets,
        now,
      });
      await writeReport();
      if (result.exitCode !== 0) {
        report.status = 'fail';
        report.failureStage = stage.name;
        report.endedAt = isoTimestamp(now);
        markRemainingStagesSkipped(report, stage.name);
        await writeReport();
        return {
          exitCode: result.exitCode,
          lines: failureLines({ report, reportPath, repoRoot, stageName: stage.name }),
          report,
        };
      }
    }

    report.status = 'pass';
    report.endedAt = isoTimestamp(now);
    await writeReport();

    return {
      exitCode: 0,
      lines: [
        'eval e2e-mcp-agent passed',
        `runId=${report.runId}`,
        `artifacts=${relativePath(repoRoot, artifacts.artifactsRoot)}`,
        `wrote ${relativePath(repoRoot, reportPath)}`,
      ],
      report,
    };
  } catch (error) {
    report.status = 'fail';
    report.endedAt = isoTimestamp(now);
    report.failureStage = report.failureStage ?? activeStageName(report);
    if (report.failureStage) {
      markRemainingStagesSkipped(report, report.failureStage);
    }
    try {
      await writeReport();
    } catch {
      // Preserve the primary failure in CLI output.
    }
    const message = redactForArtifact(
      error?.stack ?? error?.message ?? String(error),
      artifactRedactionSecrets,
    );
    return {
      exitCode: 1,
      lines: [
        'eval e2e-mcp-agent failed',
        report.failureStage ? `stage=${report.failureStage}` : 'stage=<setup>',
        `wrote ${relativePath(repoRoot, reportPath)}`,
        '',
        message,
      ],
      report,
      error,
    };
  }
}

async function runMcpAgentStage({
  repoRoot,
  options,
  artifacts,
  setupResult,
  agentRun,
  stageRunners,
  env = process.env,
  redactionSecrets = agentArtifactSecrets(options, buildAgentEnvironment(env)),
  now,
  writeAgentRun,
}) {
  if (!setupResult?.fixture) {
    throw new Error('MCP setup did not provide fixture metadata.');
  }
  if (!agentRun) {
    throw new Error('MCP agent run artifact was not initialized.');
  }

  const stageStartedAt = isoTimestamp(now);
  try {
    const workspace = await prepareAgentWorkspace({
      repoRoot,
      artifacts,
      options,
      fixture: setupResult.fixture,
    });
    const promptResult = await buildMcpAgentPrompt({
      repoRoot,
      options,
      fixture: setupResult.fixture,
      agentWorkspace: workspace,
    });
    await writeText(artifacts.prompt, promptResult.prompt);

    await writeClaudeSettings({ artifacts, options });

    agentRun.prompt.promptHash = promptHash(promptResult.prompt);
    agentRun.documents.documentCount = promptResult.documentCount;
    agentRun.workspace.path = relativePath(repoRoot, workspace.root);
    agentRun.workspace.safeDocumentIndexPath = relativePath(repoRoot, workspace.safeDocumentIndexPath);
    agentRun.agent.command = redactForArtifact(
      buildAgentInvocation({ repoRoot, options, artifacts }).display,
      redactionSecrets,
    );
    await writeAgentRun();

    const result = await stageRunners.agent({
      repoRoot,
      options,
      prompt: promptResult.prompt,
      artifacts,
      env,
      now,
    });
    const stageEndedAt = isoTimestamp(now);
    const transcript = buildTranscript(result, redactionSecrets);
    await writeText(artifacts.transcript, transcript);

    const rawTranscript = [result?.stdout, result?.stderr, result?.transcript]
      .filter((value) => typeof value === 'string')
      .join('\n');
    const completionMarkerObserved =
      typeof result?.completionMarkerObserved === 'boolean'
        ? result.completionMarkerObserved
        : completionMarkerInOutput(rawTranscript);
    const timedOut = Boolean(result?.timedOut);
    const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
    const contractErrors = agentContractErrors({
      options,
      rawTranscript,
      completionMarkerObserved,
    });
    const effectiveExitCode =
      timedOut || exitCode !== 0 || contractErrors.length > 0 ? 1 : 0;
    const duration =
      Number.isInteger(result?.durationMs) && result.durationMs >= 0
        ? result.durationMs
        : durationMs(stageStartedAt, stageEndedAt);

    const lines = redactLines(
      result?.lines?.length
        ? result.lines
        : [
            `eval MCP agent ${effectiveExitCode === 0 ? 'passed' : 'failed'}`,
            `exitCode=${exitCode}`,
            `timedOut=${timedOut}`,
            `completionMarkerObserved=${completionMarkerObserved}`,
            `transcript=${relativePath(repoRoot, artifacts.transcript)}`,
          ],
      redactionSecrets,
    );
    if (effectiveExitCode === 0 && !completionMarkerObserved) {
      lines.push('completion marker was not observed; this is diagnostic-only in v1');
    }
    appendUniqueLines(
      lines,
      contractErrors.map((error) => `agent contract error: ${error}`),
    );

    agentRun.status = effectiveExitCode === 0 ? 'pass' : 'fail';
    agentRun.endedAt = stageEndedAt;
    agentRun.agent.completionMarkerObserved = completionMarkerObserved;
    agentRun.summary.durationMs = duration;
    agentRun.summary.exitCode = exitCode;
    agentRun.summary.timedOut = timedOut;
    agentRun.error = effectiveExitCode === 0 ? null : lines.join('\n');
    await writeAgentRun();

    return {
      exitCode: effectiveExitCode,
      lines,
      agentSummary: {
        status: agentRun.status,
        durationMs: agentRun.summary.durationMs,
        exitCode: agentRun.summary.exitCode,
        timedOut: agentRun.summary.timedOut,
        completionMarkerObserved,
        transcript: relativePath(repoRoot, artifacts.transcript),
      },
    };
  } catch (error) {
    const stageEndedAt = isoTimestamp(now);
    agentRun.status = 'fail';
    agentRun.endedAt = stageEndedAt;
    agentRun.summary.durationMs = durationMs(stageStartedAt, stageEndedAt);
    agentRun.summary.exitCode = agentRun.summary.exitCode ?? 1;
    agentRun.summary.timedOut = Boolean(agentRun.summary.timedOut);
    agentRun.error = redactForArtifact(
      error?.stack ?? error?.message ?? String(error),
      redactionSecrets,
    );
    try {
      await writeAgentRun();
    } catch {
      // Preserve the primary agent-stage failure for the stage report.
    }
    throw error;
  }
}

export async function prepareOpenSchemaMemory(options) {
  return prepareKnownSchemaMemory({
    ...options,
    ensureDefinitionsEnabled: false,
  });
}

export async function captureDefinitionBaseline({
  repoRoot = defaultRepoRoot,
  options,
  artifacts,
  setupResult,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  if (!setupResult?.backendUserId) {
    throw new Error('MCP setup did not provide a backend user for definition baseline capture.');
  }
  const capturedAt = isoTimestamp(now);
  const responseData = await fetchMemorySnapshotGraphql({
    graphqlUrl: options.graphqlUrl,
    authToken: options.authToken,
    locationId: options.locationId,
    includeSuggestions: false,
    fetchImpl,
  });
  const backendUserId = responseData?.me?.userId;
  if (typeof backendUserId !== 'string' || backendUserId.length === 0) {
    throw new Error('Definition baseline response did not include me.userId.');
  }
  if (backendUserId !== setupResult.backendUserId) {
    throw new Error(
      `Definition baseline backend user ${backendUserId} does not match setup backend user ${setupResult.backendUserId}.`,
    );
  }
  const definitions = sortDefinitionRows(
    normalizeDefinitionRows({
      rows: responseData.exportPreferenceSchema,
      label: 'exportPreferenceSchema',
    }),
  );
  const artifact = buildDefinitionBaselineArtifact({
    userId: options.userId,
    corpusId: options.corpusId,
    scenarioId: options.scenarioId,
    graphqlUrl: options.graphqlUrl,
    backendUserId,
    definitions,
    capturedAt,
    schemaResetMode: OPEN_SCHEMA_BASELINE_RESET_MODE,
  });
  await validateWithSchema(
    repoRoot,
    'definition-baseline.schema.json',
    artifact,
    'definition baseline',
  );
  await writeJson(artifacts.definitionBaseline, artifact);
  return {
    exitCode: 0,
    lines: [
      'eval MCP definition baseline captured',
      `backendUser=${backendUserId}`,
      `definitions=${artifact.definitionIds.length}`,
      `strategy=${artifact.strategy}`,
      `wrote ${relativePath(repoRoot, artifacts.definitionBaseline)}`,
    ],
  };
}

async function runStage({ stage, report, redactionSecrets, now }) {
  const stageRecord = report.stages.find((candidate) => candidate.name === stage.name);
  stageRecord.status = 'running';
  stageRecord.startedAt = isoTimestamp(now);
  let result;
  try {
    result = await stage.runner();
  } catch (error) {
    stageRecord.endedAt = isoTimestamp(now);
    stageRecord.durationMs = durationMs(stageRecord.startedAt, stageRecord.endedAt);
    stageRecord.exitCode = 1;
    stageRecord.status = 'failed';
    stageRecord.lines = redactLines(
      [
        `eval stage ${stage.name} failed`,
        '',
        error?.stack ?? error?.message ?? String(error),
      ],
      redactionSecrets,
    );
    stageRecord.error = stageRecord.lines.join('\n');
    return { exitCode: 1, lines: stageRecord.lines, error };
  }
  stageRecord.endedAt = isoTimestamp(now);
  stageRecord.durationMs = durationMs(stageRecord.startedAt, stageRecord.endedAt);
  stageRecord.exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
  stageRecord.lines = redactLines(result?.lines ?? [], redactionSecrets);

  if (stageRecord.exitCode === 0) {
    try {
      if (stage.afterSuccess) {
        await stage.afterSuccess();
      }
      stageRecord.status = 'passed';
    } catch (error) {
      stageRecord.exitCode = 1;
      stageRecord.status = 'failed';
      stageRecord.lines = redactLines(
        [
          ...stageRecord.lines,
          '',
          `eval stage ${stage.name} artifact handling failed`,
          error?.stack ?? error?.message ?? String(error),
        ],
        redactionSecrets,
      );
      stageRecord.error = stageRecord.lines.join('\n');
      return { exitCode: 1, lines: stageRecord.lines, error };
    }
  } else {
    stageRecord.status = 'failed';
    stageRecord.error = stageRecord.lines.join('\n') || `Stage ${stage.name} failed.`;
  }

  return {
    ...result,
    exitCode: stageRecord.exitCode,
  };
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
    modelLabel: env.EVAL_MODEL_LABEL,
    thinkingMode: env.EVAL_THINKING_MODE || 'default',
    thinkingSource: env.EVAL_THINKING_MODE ? 'env' : 'default',
    resetMemory: false,
    resetMemoryMode: null,
    ensureDefinitions: true,
    allowTestCommandAgent: false,
    agentTimeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
    promptTemplate: null,
  };
  const valueArgs = new Set([
    '--agent',
    '--schema-mode',
    '--form-mode',
    '--user',
    '--corpus',
    '--scenario',
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
    if (arg === '--skip-ensure-definitions') {
      options.ensureDefinitions = false;
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
    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--artifacts-root') options.artifactsRoot = value;
    if (arg === '--mcp-server') options.mcpServer = value;
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--backend-url') options.backendUrl = value;
    if (arg === '--graphql-url') options.graphqlUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--agent-command') options.agentCommand = value;
    if (arg === '--agent-timeout-ms') {
      const parsed = parsePositiveInteger(value, arg);
      if (parsed.kind === 'usage-error') return parsed;
      options.agentTimeoutMs = parsed.value;
    }
    if (arg === '--prompt-template') options.promptTemplate = value;
    if (arg === '--mcp-config') options.mcpConfig = value;
    if (arg === '--model') options.model = value;
    if (arg === '--model-label') options.modelLabel = value;
    if (arg === '--thinking-mode') {
      options.thinkingMode = value;
      options.thinkingSource = 'manual';
    }
    if (arg === '--location-id') options.locationId = value;
    if (arg === '--run-id') options.runId = value;
  }

  for (const [key, flag] of [
    ['agent', '--agent'],
    ['schemaMode', '--schema-mode'],
    ['formMode', '--form-mode'],
    ['userId', '--user'],
    ['corpusId', '--corpus'],
    ['scenarioId', '--scenario'],
    ['artifactsRoot', '--artifacts-root'],
    ['mcpServer', '--mcp-server'],
  ]) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${flag}` };
    }
  }
  if (!['codex', 'claude', 'command'].includes(options.agent)) {
    return {
      kind: 'usage-error',
      message: 'Expected --agent claude or --agent command',
    };
  }
  if (options.agent === 'codex') {
    return {
      kind: 'usage-error',
      message: '--agent codex is reserved until an explicit MCP eval adapter is implemented',
    };
  }
  if (!['known', 'open'].includes(options.schemaMode)) {
    return {
      kind: 'usage-error',
      message: 'Expected --schema-mode known or open',
    };
  }
  if (options.formMode === 'agent') {
    return {
      kind: 'usage-error',
      message: '--form-mode agent is reserved for a future implementation',
    };
  }
  if (options.formMode !== 'backend') {
    return {
      kind: 'usage-error',
      message: 'Expected --form-mode backend',
    };
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
    return {
      kind: 'usage-error',
      message: 'Missing required --mcp-config when --agent claude is used',
    };
  }
  const thinkingError = validateThinkingMode(options.thinkingMode);
  if (thinkingError) {
    return { kind: 'usage-error', message: thinkingError };
  }
  for (const [label, value] of [
    ['--user', options.userId],
    ['--corpus', options.corpusId],
    ['--scenario', options.scenarioId],
  ]) {
    if (!isFixtureId(value)) {
      return { kind: 'usage-error', message: `${label} must be a fixture id.` };
    }
  }
  if (!options.authToken) {
    return {
      kind: 'usage-error',
      message: 'Missing required --auth-token or EVAL_AUTH_TOKEN',
    };
  }

  if (options.schemaMode === 'open') {
    options.ensureDefinitions = false;
  }
  options.promptTemplate =
    options.promptTemplate ??
    (options.schemaMode === 'open' ? OPEN_PROMPT_TEMPLATE : KNOWN_PROMPT_TEMPLATE);
  options.documentsRoot =
    options.documentsRoot ??
    ['examples', 'eval', 'users', options.userId, 'corpora', options.corpusId].join('/');
  options.runId = options.runId ?? generatedRunId(options, now);
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:e2e-mcp-agent --agent claude|command --schema-mode known|open --form-mode backend --user <userId> --corpus <corpusId> --scenario <scenarioId> --artifacts-root <dir> --mcp-server <name> [options]',
    '',
    'Notes:',
    '  This wrapper runs one MCP memory ingestion eval through one agent session.',
    '  Known schema uses stored-preferences artifacts; open schema uses memory-snapshot artifacts.',
    '  Open schema supports the deterministic command adapter and live Claude backend-form runs.',
    '  Agent-filled forms are reserved and fail fast until implemented.',
    '  Low scores are reported but do not fail the wrapper. Runtime/setup failures stop the run.',
    '  Prefer EVAL_AUTH_TOKEN over --auth-token to avoid shell history and process-list exposure.',
    '  --agent command is test-only and is not benchmark-safe filesystem isolation.',
    '  Live Claude scores require the MCP config to authenticate as the same backend user as EVAL_AUTH_TOKEN; v1 records but does not verify that identity.',
    `  Live Claude runs fail if the MCP server is disconnected, no mcp__<server>__* tools are exposed, or ${COMPLETION_MARKER} is missing.`,
    '  mcp-agent-transcript.txt can contain corpus PII; keep artifact roots out of commits and casual sharing.',
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
    '  --prompt-template <path>          Defaults by schema mode to the MCP known/open prompt template',
    '  --model <model>                   Defaults to EVAL_MODEL; passed to Claude Code when --agent claude',
    '  --model-label <label>             Defaults to EVAL_MODEL_LABEL; metadata-only fallback',
    '  --thinking-mode <mode>            Claude Code only: default|low|medium|high|xhigh|max',
    '  --reset-memory                    Clear current backend user memory values before the agent run',
    '  --reset-demo-data                 Clear current backend user demo data, including user-owned definitions; requires backend ENABLE_DEMO_RESET=true',
    '  --skip-ensure-definitions          Do not create missing known-schema definitions; forced in open mode',
    '  --location-id <locationId>         Export merged global + location view',
    '  --run-id <id>',
  ].join('\n');
}

export function formatMcpAgentE2EResult(result) {
  return result.lines.join('\n');
}

export async function buildMcpAgentPrompt({ repoRoot, options, fixture, agentWorkspace }) {
  const loadedFixture =
    fixture ??
    (await loadKnownSchemaFixture({
      repoRoot,
      evalUserId: options.userId,
      corpusId: options.corpusId,
      documentsRoot: options.documentsRoot,
    }));
  const scenarioRoot = path.join(repoRoot, 'examples/eval/scenarios', options.scenarioId);
  const scenario = await readJson(path.join(scenarioRoot, 'scenario.json'));
  const scenarioPrompt = (await readFile(path.join(scenarioRoot, 'start/prompt.md'), 'utf8')).trim();
  const templatePath = path.resolve(repoRoot, options.promptTemplate);
  const template = await readFile(templatePath, 'utf8');
  const prompt = renderTemplate(template, {
    MCP_SERVER: options.mcpServer,
    SCENARIO_PROMPT: scenarioContext(scenario, scenarioPrompt),
    FORM_ID: scenario.formId ?? '<unknown>',
    SCHEMA_MODE: options.schemaMode,
    FORM_MODE: options.formMode,
    DOCUMENTS_ROOT: agentWorkspace
      ? displayPath(repoRoot, agentWorkspace.root)
      : displayPath(repoRoot, path.resolve(repoRoot, options.documentsRoot)),
    DOCUMENT_LIST: documentList(loadedFixture.manifest.documents ?? []),
    COMPLETION_MARKER,
  });
  return {
    prompt,
    documentCount: loadedFixture.manifest.documents?.length ?? 0,
  };
}

export async function runAgentProcess({
  repoRoot = defaultRepoRoot,
  options,
  prompt,
  artifacts,
  env = process.env,
}) {
  const effectiveArtifacts =
    artifacts ??
    (options.artifactsRoot
      ? buildArtifacts({ repoRoot, options })
      : {
          agentWorkspaceRoot: repoRoot,
          claudeSettings: path.join(repoRoot, 'claude-settings.json'),
        });
  const invocation = buildAgentInvocation({ repoRoot, options, artifacts: effectiveArtifacts });
  const childEnv = buildAgentEnvironment(env);
  const redactionSecrets = agentArtifactSecrets(options, childEnv);
  const startedAtMs = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    let timedOut = false;
    let closed = false;
    let forceKillTimeout = null;
    const child = spawn(invocation.file, invocation.args, {
      cwd: invocation.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimeout = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, 2_000);
      forceKillTimeout.unref();
    }, options.agentTimeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.stdin.on('error', () => {
      // The process may exit before reading all input; close handling reports it.
    });
    child.on('close', (code, signal) => {
      closed = true;
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      const durationMs = Math.max(0, Date.now() - startedAtMs);
      const exitCode = timedOut || spawnError ? 1 : Number.isInteger(code) ? code : 1;
      const combined = `${stdout}\n${stderr}`;
      const completionMarkerObserved = completionMarkerInOutput(combined);
      const lines = [
        `agent ${options.agent} ${exitCode === 0 && !timedOut ? 'completed' : 'failed'}`,
        `command=${redactForArtifact(invocation.display, redactionSecrets)}`,
        `exitCode=${exitCode}`,
        `timedOut=${timedOut}`,
        `completionMarkerObserved=${completionMarkerObserved}`,
      ];
      if (signal) lines.push(`signal=${signal}`);
      if (spawnError) lines.push(redactForArtifact(spawnError.message, redactionSecrets));
      resolve({
        exitCode,
        lines,
        stdout,
        stderr,
        timedOut,
        durationMs,
        command: invocation.display,
        completionMarkerObserved,
      });
    });
    child.stdin.end(prompt);
  });
}

export function buildAgentInvocation({ repoRoot, options, artifacts }) {
  const agentWorkspaceRoot = artifacts?.agentWorkspaceRoot ?? repoRoot;
  const claudeSettings = artifacts?.claudeSettings ?? path.join(agentWorkspaceRoot, 'claude-settings.json');
  if (options.agent === 'claude') {
    const mcpConfigPath = path.resolve(repoRoot, options.mcpConfig);
    const args = buildClaudeCodeArgs({
      model: options.model,
      thinkingMode: options.thinkingMode,
      mcpConfig: mcpConfigPath,
      strictMcpConfig: true,
      settings: claudeSettings,
      tools: CLAUDE_BUILTIN_TOOLS,
      allowedTools: `${CLAUDE_BUILTIN_TOOLS},mcp__${options.mcpServer}__*`,
    });
    return {
      file: 'claude',
      args,
      display: ['claude', ...args.map(shellDisplayArg)].join(' '),
      cwd: agentWorkspaceRoot,
    };
  }
  return {
    file: '/bin/sh',
    args: ['-lc', options.agentCommand],
    display: options.agentCommand,
    cwd: agentWorkspaceRoot,
  };
}

export async function prepareAgentWorkspace({
  repoRoot,
  artifacts,
  options,
  fixture,
  documents: orderedDocuments = null,
}) {
  const root = artifacts.agentWorkspaceRoot;
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const sourceRoot = path.resolve(repoRoot, fixture.documentsRoot ?? options.documentsRoot);
  const documents = orderedDocuments ?? fixture.manifest?.documents ?? [];
  const safeDocuments = [];
  for (const doc of documents) {
    const relativeDocPath = safeRelativePath(doc.path, 'document path');
    const sourcePath = path.resolve(sourceRoot, relativeDocPath);
    if (!isInside(sourceRoot, sourcePath)) {
      throw new Error(`Document path escapes documents root: ${doc.path}`);
    }
    const destinationPath = path.resolve(root, relativeDocPath);
    if (!isInside(root, destinationPath)) {
      throw new Error(`Document path escapes agent workspace: ${doc.path}`);
    }
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    safeDocuments.push(safeDocumentMetadata(doc));
  }

  await writeJson(artifacts.safeDocumentIndex, {
    schemaVersion: 1,
    artifactType: 'mcp-agent-document-index',
    documentsRoot: '.',
    documentCount: safeDocuments.length,
    documents: safeDocuments,
  });
  const instructions = [
    '# Eval Agent Workspace',
    '',
    `Use the MCP server named \`${options.mcpServer}\` for memory reads and writes.`,
    'Read only files in this workspace. Do not access the source repository, generated artifacts, validation reports, score reports, profile files, manifests, or expected snapshots.',
    'The safe document index is `documents.json`; listed document paths are relative to this workspace.',
    `Print ${COMPLETION_MARKER} on its own line when finished.`,
    '',
  ].join('\n');
  await writeText(artifacts.agentInstructions, instructions);
  await writeText(artifacts.agentCodexInstructions, instructions);

  return {
    root,
    safeDocumentIndexPath: artifacts.safeDocumentIndex,
    documents: safeDocuments,
  };
}

async function writeClaudeSettings({ artifacts, options }) {
  await writeJson(artifacts.claudeSettings, {
    permissions: {
      allow: ['Read', 'Glob', 'Grep', `mcp__${options.mcpServer}__*`],
    },
  });
}

function safeDocumentMetadata(doc) {
  return {
    id: doc.id ?? null,
    path: safeRelativePath(doc.path, 'document path'),
    title: doc.title ?? null,
    category: doc.category ?? null,
    outputExtension: doc.outputExtension ?? null,
  };
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be relative: ${value}`);
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} escapes its root: ${value}`);
  }
  return normalized.split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function buildArtifacts({ repoRoot, options }) {
  const artifactsRoot = path.resolve(repoRoot, options.artifactsRoot);
  const agentWorkspaceRoot = path.join(artifactsRoot, 'agent-workspace');
  return {
    artifactsRoot,
    agentWorkspaceRoot,
    safeDocumentIndex: path.join(agentWorkspaceRoot, 'documents.json'),
    agentInstructions: path.join(agentWorkspaceRoot, 'CLAUDE.md'),
    agentCodexInstructions: path.join(agentWorkspaceRoot, 'AGENTS.md'),
    claudeSettings: path.join(artifactsRoot, 'claude-settings.json'),
    validationReport: path.join(artifactsRoot, 'validation-report.json'),
    mcpAgentRun: path.join(artifactsRoot, 'mcp-agent-run.json'),
    prompt: path.join(artifactsRoot, 'mcp-agent-prompt.md'),
    transcript: path.join(artifactsRoot, 'mcp-agent-transcript.txt'),
    definitionBaseline: path.join(artifactsRoot, 'definition-baseline.json'),
    memorySnapshot: path.join(artifactsRoot, 'memory-snapshot.json'),
    storedPreferences: path.join(artifactsRoot, 'stored-preferences.json'),
    databaseScoreReport: path.join(artifactsRoot, 'database-score-report.json'),
    openSchemaDatabaseScoreReport: path.join(artifactsRoot, 'open-schema-database-score-report.json'),
    filledForm: path.join(artifactsRoot, 'filled-form.json'),
    filledPdf: path.join(artifactsRoot, 'filled-form.pdf'),
    formFillResponse: path.join(artifactsRoot, 'form-fill-response.json'),
    formScoreReport: path.join(artifactsRoot, 'form-score-report.json'),
    combinedScoreReport: path.join(artifactsRoot, 'combined-score-report.json'),
    openSchemaCombinedScoreReport: path.join(artifactsRoot, 'open-schema-combined-score-report.json'),
    evaluationRun: path.join(artifactsRoot, 'evaluation-run.json'),
  };
}

function initialReport({ repoRoot, options, artifacts, startedAt }) {
  return {
    schemaVersion: 2,
    artifactType: 'evaluation-run',
    evaluationMode:
      options.schemaMode === 'open'
        ? MCP_OPEN_SCHEMA_EVALUATION_MODE
        : MCP_KNOWN_SCHEMA_EVALUATION_MODE,
    status: 'running',
    runId: options.runId,
    userId: options.userId,
    corpusId: options.corpusId,
    scenarioId: options.scenarioId,
    documentsRoot: displayPath(repoRoot, path.resolve(repoRoot, options.documentsRoot)),
    artifactsRoot: relativePath(repoRoot, artifacts.artifactsRoot),
    backendUrl: sanitizeUrlForArtifact(options.backendUrl),
    graphqlUrl: sanitizeUrlForArtifact(options.graphqlUrl),
    model: modelMetadata(options),
    locationId: options.locationId ?? null,
    settings: {
      resetMemory: options.resetMemory,
      resetMode: options.resetMemoryMode,
      ensureDefinitions: options.ensureDefinitions,
      autoApply: false,
      seedPreferences: false,
      schemaMode: options.schemaMode,
      formMode: options.formMode,
      agent: options.agent,
      mcpServer: options.mcpServer,
      commandAdapterTestOnly: options.agent === 'command' && options.allowTestCommandAgent,
      agentTimeoutMs: options.agentTimeoutMs,
      promptTemplate: displayPath(repoRoot, path.resolve(repoRoot, options.promptTemplate)),
      mcpConfig: options.mcpConfig
        ? displayPath(repoRoot, path.resolve(repoRoot, options.mcpConfig))
        : null,
      agentWorkspace: relativePath(repoRoot, artifacts.agentWorkspaceRoot),
    },
    backendUserId: null,
    failureStage: null,
    stages: stageNamesForMode(options.schemaMode).map((name) => ({
      name,
      status: 'pending',
      startedAt: null,
      endedAt: null,
      durationMs: null,
      exitCode: null,
      artifacts: artifactMapForStage({ repoRoot, artifacts, name }),
      lines: [],
      error: null,
    })),
    summaries: {
      validation: null,
      setup: null,
      ingestion: null,
      agent: null,
      export: null,
      databaseScore: null,
      formFill: null,
      formScore: null,
      combinedScore: null,
    },
    startedAt,
    endedAt: null,
  };
}

function initialAgentRun({ repoRoot, options, artifacts, setupResult, startedAt }) {
  const summary = setupSummary(setupResult, options);
  return {
    schemaVersion: 3,
    artifactType: 'mcp-agent-run',
    runId: options.runId,
    status: 'running',
    userId: options.userId,
    corpusId: options.corpusId,
    scenarioId: options.scenarioId,
    schemaMode: options.schemaMode,
    formMode: options.formMode,
    backendUserId: setupResult.backendUserId ?? null,
    agent: {
      provider: options.agent,
      modelLabel: options.model ?? options.modelLabel ?? null,
      mcpServer: options.mcpServer,
      timeoutMs: options.agentTimeoutMs,
      command: null,
      completionMarkerObserved: null,
    },
    identity: {
      runnerBackendUserId: setupResult.backendUserId ?? null,
      mcpBackendUserId: null,
      verifiedSameBackendUser: false,
      verificationMethod: 'not-implemented',
    },
    setup: {
      resetMemory: options.resetMemory,
      resetMode: options.resetMemoryMode,
      knownSchemaDefinitionsEnsured: options.ensureDefinitions,
      createdDefinitionCount: summary.createdDefinitionCount,
      existingDefinitionCount: summary.existingDefinitionCount,
      skippedDefinitionCount: summary.skippedDefinitionCount,
    },
    prompt: {
      templatePath: displayPath(repoRoot, path.resolve(repoRoot, options.promptTemplate)),
      renderedPromptPath: relativePath(repoRoot, artifacts.prompt),
      promptHash: null,
    },
    documents: {
      sourceDocumentsRoot: displayPath(repoRoot, path.resolve(repoRoot, options.documentsRoot)),
      documentsRoot: relativePath(repoRoot, artifacts.agentWorkspaceRoot),
      documentCount: setupResult.fixture?.manifest?.documents?.length ?? null,
    },
    workspace: {
      path: relativePath(repoRoot, artifacts.agentWorkspaceRoot),
      safeDocumentIndexPath: relativePath(repoRoot, artifacts.safeDocumentIndex),
      containsOnlyDeclaredDocuments: true,
      hardFilesystemBoundary: false,
    },
    transcript: {
      path: relativePath(repoRoot, artifacts.transcript),
      redactedAuthSecrets: true,
      mayContainCorpusPii: true,
    },
    summary: {
      durationMs: null,
      exitCode: null,
      timedOut: false,
      toolCallCount: null,
      preferenceWriteCount: null,
      definitionCreateCount: null,
    },
    artifacts: agentRunArtifactMap({ repoRoot, options, artifacts }),
    startedAt,
    endedAt: null,
    error: null,
  };
}

function stageNamesForMode(schemaMode) {
  return schemaMode === 'open' ? OPEN_STAGE_NAMES : KNOWN_STAGE_NAMES;
}

function agentRunArtifactMap({ repoRoot, options, artifacts }) {
  const common = {
    validationReport: relativePath(repoRoot, artifacts.validationReport),
    filledForm: relativePath(repoRoot, artifacts.filledForm),
    filledPdf: relativePath(repoRoot, artifacts.filledPdf),
    formFillResponse: relativePath(repoRoot, artifacts.formFillResponse),
    formScoreReport: relativePath(repoRoot, artifacts.formScoreReport),
    evaluationRun: relativePath(repoRoot, artifacts.evaluationRun),
  };
  if (options.schemaMode === 'open') {
    return {
      ...common,
      definitionBaseline: relativePath(repoRoot, artifacts.definitionBaseline),
      memorySnapshot: relativePath(repoRoot, artifacts.memorySnapshot),
      openSchemaDatabaseScoreReport: relativePath(
        repoRoot,
        artifacts.openSchemaDatabaseScoreReport,
      ),
      openSchemaCombinedScoreReport: relativePath(
        repoRoot,
        artifacts.openSchemaCombinedScoreReport,
      ),
    };
  }
  return {
    ...common,
    storedPreferences: relativePath(repoRoot, artifacts.storedPreferences),
    databaseScoreReport: relativePath(repoRoot, artifacts.databaseScoreReport),
    combinedScoreReport: relativePath(repoRoot, artifacts.combinedScoreReport),
  };
}

function setupSummary(setupResult, options) {
  const definitionSetup = setupResult?.definitionSetup ?? {};
  return {
    backendUserId: setupResult?.backendUserId ?? null,
    resetMemory: options.resetMemory,
    resetMode: options.resetMemoryMode,
    ensureDefinitions: options.ensureDefinitions,
    createdDefinitionCount: definitionSetup.created?.length ?? 0,
    existingDefinitionCount: definitionSetup.existing?.length ?? 0,
    skippedDefinitionCount: definitionSetup.skipped?.length ?? 0,
  };
}

function artifactMapForStage({ repoRoot, artifacts, name }) {
  const map = {
    'validate-documents': { validationReport: artifacts.validationReport },
    'setup-memory-and-schema': { mcpAgentRun: artifacts.mcpAgentRun },
    'setup-open-schema-memory': { mcpAgentRun: artifacts.mcpAgentRun },
    'capture-definition-baseline': { definitionBaseline: artifacts.definitionBaseline },
    'run-mcp-agent': {
      mcpAgentRun: artifacts.mcpAgentRun,
      agentWorkspace: artifacts.agentWorkspaceRoot,
      safeDocumentIndex: artifacts.safeDocumentIndex,
      claudeSettings: artifacts.claudeSettings,
      prompt: artifacts.prompt,
      transcript: artifacts.transcript,
    },
    'export-stored-preferences': { storedPreferences: artifacts.storedPreferences },
    'export-memory-snapshot': { memorySnapshot: artifacts.memorySnapshot },
    'score-database': { databaseScoreReport: artifacts.databaseScoreReport },
    'score-open-schema-database': {
      openSchemaDatabaseScoreReport: artifacts.openSchemaDatabaseScoreReport,
    },
    'fill-form': {
      filledForm: artifacts.filledForm,
      filledPdf: artifacts.filledPdf,
      response: artifacts.formFillResponse,
    },
    'score-form': { formScoreReport: artifacts.formScoreReport },
    'score-combined': { combinedScoreReport: artifacts.combinedScoreReport },
    'score-open-schema-combined': {
      openSchemaCombinedScoreReport: artifacts.openSchemaCombinedScoreReport,
    },
  }[name];
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, relativePath(repoRoot, value)]),
  );
}

function exportArgs(options, artifacts) {
  const args = [
    '--user',
    options.userId,
    '--corpus',
    options.corpusId,
    '--out',
    artifacts.storedPreferences,
    '--graphql-url',
    options.graphqlUrl,
    '--auth-token',
    options.authToken,
    '--ingestion-mode',
    MCP_KNOWN_SCHEMA_PRODUCER,
    '--suggestions-were-auto-applied',
    'false',
    '--run-id',
    options.runId,
  ];
  if (options.locationId) args.push('--location-id', options.locationId);
  return args;
}

function exportMemorySnapshotArgs(options, artifacts) {
  const args = [
    '--user',
    options.userId,
    '--corpus',
    options.corpusId,
    '--scenario',
    options.scenarioId,
    '--out',
    artifacts.memorySnapshot,
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
    '--baseline-in',
    artifacts.definitionBaseline,
    '--run-id',
    options.runId,
  ];
  if (options.locationId) args.push('--location-id', options.locationId);
  return args;
}

function renderTemplate(template, values) {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.split(`{{${key}}}`).join(String(value));
  }
  return rendered;
}

function scenarioContext(scenario, prompt) {
  return [
    scenario.scenarioId ? `Scenario id: ${scenario.scenarioId}` : null,
    scenario.description ? `Purpose: ${scenario.description}` : null,
    prompt ? `Prompt: ${prompt}` : null,
  ]
    .filter(Boolean)
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

function buildTranscript(result, secrets) {
  const sections = [];
  if (result?.command) {
    sections.push(`$ ${result.command}`);
  }
  if (typeof result?.transcript === 'string' && result.transcript.length > 0) {
    sections.push(result.transcript);
  }
  if (typeof result?.stdout === 'string') {
    sections.push(`[stdout]\n${result.stdout}`);
  }
  if (typeof result?.stderr === 'string') {
    sections.push(`[stderr]\n${result.stderr}`);
  }
  return `${redactForArtifact(sections.join('\n\n'), secrets)}\n`;
}

async function writeText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

function markRemainingStagesSkipped(report, failedStageName) {
  let afterFailed = false;
  for (const stage of report.stages) {
    if (afterFailed && stage.status === 'pending') {
      stage.status = 'skipped';
    }
    if (stage.name === failedStageName) {
      afterFailed = true;
    }
  }
}

function activeStageName(report) {
  return report.stages.find((stage) => stage.status === 'running')?.name ?? null;
}

function failureLines({ report, reportPath, repoRoot, stageName }) {
  const stage = report.stages.find((candidate) => candidate.name === stageName);
  const lines = [
    'eval e2e-mcp-agent failed',
    `stage=${stageName}`,
    `runId=${report.runId}`,
    `artifacts=${report.artifactsRoot}`,
    `wrote ${relativePath(repoRoot, reportPath)}`,
  ];
  if (stage?.artifacts?.response) {
    lines.push(`response=${stage.artifacts.response}`);
  }
  if (stage?.artifacts?.transcript) {
    lines.push(`transcript=${stage.artifacts.transcript}`);
  }
  return [...lines, '', ...(stage?.lines ?? [])];
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function durationMs(startedAt, endedAt) {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}

function generatedRunId(options, now) {
  return [
    options.schemaMode === 'open'
      ? MCP_OPEN_SCHEMA_EVALUATION_MODE
      : MCP_KNOWN_SCHEMA_EVALUATION_MODE,
    options.userId,
    options.corpusId,
    isoTimestamp(now).replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, ''),
  ].join('-');
}

function modelMetadata(options) {
  const label = options.model ?? options.modelLabel;
  if (label) {
    return {
      label,
      source: 'manual',
    };
  }
  return {
    label: null,
    source: 'unspecified',
  };
}

export function mcpThinkingMetadata(options) {
  if (options.agent !== 'claude') return null;
  return thinkingMetadata({
    thinkingMode: options.thinkingMode ?? 'default',
    source: options.thinkingSource ?? 'unspecified',
  });
}

function parsePositiveInteger(value, flag) {
  if (!/^[0-9]+$/.test(value)) {
    return {
      kind: 'usage-error',
      message: `Expected ${flag} to be a positive integer`,
    };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return {
      kind: 'usage-error',
      message: `Expected ${flag} to be a positive integer`,
    };
  }
  return { kind: 'ok', value: parsed };
}

function promptHash(prompt) {
  return `sha256:${createHash('sha256').update(prompt).digest('hex')}`;
}

function displayPath(repoRoot, filePath) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const absoluteFilePath = path.resolve(filePath);
  const relative = path.relative(absoluteRepoRoot, absoluteFilePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return absoluteFilePath.split(path.sep).join('/');
}

function shellDisplayArg(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function buildAgentEnvironment(sourceEnv = process.env) {
  const allowedExact = new Set([
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'SHELL',
    'USER',
    'LOGNAME',
    'TERM',
    'COLORTERM',
    'NO_COLOR',
    'FORCE_COLOR',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    // Model-provider auth for Claude Code headless/cloud runs. Do not add
    // eval/backend/database credentials to this allowlist.
    'ANTHROPIC_BEDROCK_BASE_URL',
    'ANTHROPIC_FOUNDRY_API_KEY',
    'ANTHROPIC_FOUNDRY_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_VERTEX_PROJECT_ID',
    'ANTHROPIC_VERTEX_REGION',
    'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CONFIG_DIR',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
    'AWS_PROFILE',
    'AWS_CONFIG_FILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_ROLE_ARN',
    'AWS_ROLE_SESSION_NAME',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_EC2_METADATA_DISABLED',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GCLOUD_PROJECT',
    'GCP_PROJECT',
    'GCP_PROJECT_ID',
    'CLOUDSDK_CONFIG',
    'CLOUDSDK_CORE_PROJECT',
    'CLOUD_ML_REGION',
    'AZURE_AUTHORITY_HOST',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_FEDERATED_TOKEN_FILE',
    'AZURE_TENANT_ID',
    'AZURE_USERNAME',
    'AZURE_PASSWORD',
    'AZURE_SUBSCRIPTION_ID',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ]);
  const result = {};
  for (const key of allowedExact) {
    if (typeof sourceEnv[key] === 'string') {
      result[key] = sourceEnv[key];
    }
  }
  return result;
}

function agentArtifactSecrets(options, agentEnv = {}) {
  return [
    options?.authToken,
    ...Object.entries(agentEnv)
      .filter(([key, value]) => isSensitiveAgentEnvKey(key) && typeof value === 'string')
      .map(([, value]) => value),
  ];
}

function isSensitiveAgentEnvKey(key) {
  return /(?:AUTH|TOKEN|SECRET|KEY|CREDENTIAL|PASSWORD)/i.test(key);
}

function completionMarkerInOutput(text) {
  if (typeof text !== 'string' || !text.includes(COMPLETION_MARKER)) return false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === COMPLETION_MARKER) return true;
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (jsonAssistantOutputHasMarker(parsed)) return true;
    } catch {
      // Non-JSON lines are handled by the exact-line check above.
    }
  }
  return false;
}

function jsonAssistantOutputHasMarker(value) {
  if (!value || typeof value !== 'object') return false;
  const encoded = JSON.stringify(value);
  if (!encoded.includes(COMPLETION_MARKER)) return false;
  if (encoded.includes('"role":"user"') || encoded.includes('"type":"user"')) {
    return false;
  }
  return true;
}

function agentContractErrors({ options, rawTranscript, completionMarkerObserved }) {
  if (options.agent !== 'claude') return [];

  const errors = [];
  const initEvent = findClaudeInitEvent(rawTranscript);
  if (!initEvent) {
    errors.push(
      `Claude init event was not found; cannot verify MCP server ${options.mcpServer} is connected.`,
    );
  } else {
    errors.push(
      ...claudeMcpAvailabilityErrors({
        initEvent,
        rawTranscript,
        mcpServer: options.mcpServer,
      }),
    );
  }
  if (!completionMarkerObserved) {
    errors.push(`required completion marker ${COMPLETION_MARKER} was not observed.`);
  }
  return errors;
}

function findClaudeInitEvent(text) {
  if (typeof text !== 'string') return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === 'system' && parsed?.subtype === 'init') {
        return parsed;
      }
    } catch {
      // Ignore incomplete or non-JSON transcript lines.
    }
  }
  return null;
}

function claudeMcpAvailabilityErrors({ initEvent, rawTranscript, mcpServer }) {
  const errors = [];
  const servers = Array.isArray(initEvent?.mcp_servers) ? initEvent.mcp_servers : [];
  const server = servers.find((candidate) => candidate?.name === mcpServer);
  if (!server) {
    errors.push(`MCP server ${mcpServer} was not listed in Claude init event.`);
  } else if (server.status !== 'connected' && server.status !== 'pending') {
    errors.push(`MCP server ${mcpServer} status was ${server.status ?? '<missing>'}, not connected.`);
  }

  const mcpToolPrefix = `mcp__${mcpServer}__`;
  if (!claudeMcpToolObserved({ initEvent, rawTranscript, mcpToolPrefix })) {
    errors.push(`No Claude tools were exposed with prefix ${mcpToolPrefix}*.`);
  }
  return errors;
}

function claudeMcpToolObserved({ initEvent, rawTranscript, mcpToolPrefix }) {
  const tools = Array.isArray(initEvent?.tools) ? initEvent.tools : [];
  if (tools.some((toolName) => typeof toolName === 'string' && toolName.startsWith(mcpToolPrefix))) {
    return true;
  }
  if (typeof rawTranscript !== 'string') return false;
  for (const line of rawTranscript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      if (jsonValueHasMcpToolName(JSON.parse(trimmed), mcpToolPrefix)) return true;
    } catch {
      // Ignore incomplete or non-JSON transcript lines.
    }
  }
  return false;
}

function jsonValueHasMcpToolName(value, mcpToolPrefix) {
  if (typeof value === 'string') {
    return value.startsWith(mcpToolPrefix);
  }
  if (Array.isArray(value)) {
    return value.some((item) => jsonValueHasMcpToolName(item, mcpToolPrefix));
  }
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((item) => jsonValueHasMcpToolName(item, mcpToolPrefix));
}

function redactLines(lines, secrets) {
  return lines.map((line) => redactForArtifact(String(line), secrets));
}

function appendUniqueLines(lines, additions) {
  for (const addition of additions) {
    if (!lines.includes(addition)) lines.push(addition);
  }
}

function redactForArtifact(text, secrets = []) {
  let redacted = String(text);
  for (const secret of normalizeSecrets(secrets)) {
    redacted = redacted.split(secret).join('[redacted-auth-token]');
  }
  redacted = redacted.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
    'Bearer [redacted-bearer-token]',
  );
  redacted = redacted.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    '[redacted-jwt]',
  );
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-api-key]');
  return redacted;
}

function normalizeSecrets(secrets) {
  const list = Array.isArray(secrets) ? secrets : [secrets];
  return list.filter((secret) => typeof secret === 'string' && secret.length > 0);
}

function sanitizeUrlForArtifact(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runMcpAgentE2E({ args: process.argv.slice(2) });
  console.log(formatMcpAgentE2EResult(result));
  process.exitCode = result.exitCode;
}
