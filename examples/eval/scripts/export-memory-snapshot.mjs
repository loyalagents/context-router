#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMemorySnapshotGraphql } from './memory-snapshot/client.mjs';
import {
  buildDefinitionBaselineArtifact,
  buildMemorySnapshotArtifact,
  normalizeDefinitionRows,
  readBaselineFromArtifact,
  sortDefinitionRows,
} from './memory-snapshot/mapper.mjs';
import {
  redactMemorySnapshotSecrets,
  sanitizeGraphqlUrl,
} from './memory-snapshot/sanitize.mjs';
import {
  readJson,
  relativePath,
  validateWithSchema,
  writeJson,
} from './scoring/io.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_GRAPHQL_URL = 'http://localhost:3000/graphql';
const SCHEMA_MODES = new Set(['open', 'known']);
const SCHEMA_RESET_MODES = new Set([
  'none',
  'fresh-user',
  'archive-eval-owned',
  'baseline-only',
]);

export async function runExportMemorySnapshot({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const parsed = parseArgs(args, env, now);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  try {
    const exportedAt = isoTimestamp(now);
    const responseData = await fetchMemorySnapshotGraphql({
      graphqlUrl: options.graphqlUrl,
      authToken: options.authToken,
      locationId: options.locationId,
      includeSuggestions: options.includeSuggestions,
      fetchImpl,
    });
    const backendUserId = authenticatedBackendUserId(responseData);
    const definitions = sortDefinitionRows(
      normalizeDefinitionRows({
        rows: responseData.exportPreferenceSchema,
        label: 'exportPreferenceSchema',
      }),
    );

    let baselineArtifact = null;
    if (options.baselineIn) {
      baselineArtifact = readBaselineFromArtifact({
        artifact: await readJson(path.resolve(repoRoot, options.baselineIn)),
        expectedUserId: options.userId,
        expectedCorpusId: options.corpusId,
        expectedScenarioId: options.scenarioId,
        expectedBackendUserId: backendUserId,
      });
    }

    let writtenBaselinePath = null;
    if (options.baselineOut) {
      const outBaseline = buildDefinitionBaselineArtifact({
        userId: options.userId,
        corpusId: options.corpusId,
        scenarioId: options.scenarioId,
        graphqlUrl: options.graphqlUrl,
        backendUserId,
        definitions,
        capturedAt: exportedAt,
        schemaResetMode: options.schemaResetMode,
      });
      baselineArtifact = {
        capturedAt: outBaseline.capturedAt,
        strategy: outBaseline.strategy,
        definitionIds: outBaseline.definitionIds,
        slugs: outBaseline.slugs,
      };
      writtenBaselinePath = path.resolve(repoRoot, options.baselineOut);
      await writeJson(writtenBaselinePath, outBaseline);
    }

    const artifact = buildMemorySnapshotArtifact({
      userId: options.userId,
      corpusId: options.corpusId,
      scenarioId: options.scenarioId,
      graphqlUrl: options.graphqlUrl,
      locationId: options.locationId,
      includeSuggestions: options.includeSuggestions,
      producer: options.producer,
      schemaMode: options.schemaMode,
      schemaResetMode: options.schemaResetMode,
      runId: options.runId,
      responseData,
      exportedAt,
      baselineArtifact,
    });

    await validateWithSchema(
      repoRoot,
      'memory-snapshot.schema.json',
      artifact,
      'exported memory snapshot',
    );

    const outPath = path.resolve(repoRoot, options.out);
    await writeJson(outPath, artifact);

    const lines = [
      'eval export-memory-snapshot passed',
      `active=${artifact.preferences.length} definitions=${artifact.definitions.length} suggestions=${artifact.suggestions?.length ?? 0}`,
      `graphql ${sanitizeGraphqlUrl(options.graphqlUrl)}`,
      `wrote ${relativePath(repoRoot, outPath)}`,
    ];
    if (writtenBaselinePath) {
      lines.push(`baseline ${relativePath(repoRoot, writtenBaselinePath)}`);
    }
    return { exitCode: 0, lines };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [
        'eval export-memory-snapshot failed',
        '',
        redactMemorySnapshotSecrets(error?.stack ?? error?.message ?? String(error), {
          authToken: options.authToken,
          graphqlUrl: options.graphqlUrl,
        }),
      ],
      error,
    };
  }
}

export function parseArgs(args, env = process.env, now = () => new Date()) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    graphqlUrl: env.EVAL_GRAPHQL_URL || DEFAULT_GRAPHQL_URL,
    authToken: env.EVAL_AUTH_TOKEN,
    includeSuggestions: false,
    producer: 'manual-or-export',
    schemaMode: 'open',
    schemaResetMode: 'none',
  };

  const valueArgs = new Set([
    '--user',
    '--corpus',
    '--scenario',
    '--out',
    '--graphql-url',
    '--auth-token',
    '--location-id',
    '--producer',
    '--schema-mode',
    '--schema-reset-mode',
    '--baseline-in',
    '--baseline-out',
    '--run-id',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--include-suggestions') {
      options.includeSuggestions = true;
      continue;
    }
    if (!valueArgs.has(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--out') options.out = value;
    if (arg === '--graphql-url') options.graphqlUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--location-id') options.locationId = value;
    if (arg === '--producer') options.producer = value;
    if (arg === '--schema-mode') options.schemaMode = value;
    if (arg === '--schema-reset-mode') options.schemaResetMode = value;
    if (arg === '--baseline-in') options.baselineIn = value;
    if (arg === '--baseline-out') options.baselineOut = value;
    if (arg === '--run-id') options.runId = value;
  }

  for (const key of ['userId', 'corpusId', 'out']) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${optionName(key)}` };
    }
  }
  if (!options.authToken) {
    return {
      kind: 'usage-error',
      message: 'Missing required --auth-token or EVAL_AUTH_TOKEN',
    };
  }
  if (!SCHEMA_MODES.has(options.schemaMode)) {
    return {
      kind: 'usage-error',
      message: 'Expected --schema-mode open or known',
    };
  }
  if (!SCHEMA_RESET_MODES.has(options.schemaResetMode)) {
    return {
      kind: 'usage-error',
      message: 'Expected --schema-reset-mode none, fresh-user, archive-eval-owned, or baseline-only',
    };
  }
  if (typeof options.producer !== 'string' || options.producer.trim().length === 0) {
    return { kind: 'usage-error', message: '--producer must be a non-empty string' };
  }
  if (options.baselineIn && options.baselineOut) {
    return {
      kind: 'usage-error',
      message: 'Use only one of --baseline-in or --baseline-out',
    };
  }

  options.runId = options.runId ?? generatedRunId(options, now);
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:export-memory-snapshot --user <userId> --corpus <corpusId> --out <file> [options]',
    '',
    'Notes:',
    '  Relative output paths are resolved from the repo root.',
    '  Prefer EVAL_AUTH_TOKEN over --auth-token to avoid shell history and process-list exposure.',
    '  This command only exports memory/schema artifacts; it does not score, run MCP agents, or mutate backend state.',
    '',
    'Options:',
    '  --scenario <scenarioId>                   Record scenario metadata',
    '  --graphql-url <url>                       Defaults to EVAL_GRAPHQL_URL or http://localhost:3000/graphql',
    '  --auth-token <token>                      Defaults to EVAL_AUTH_TOKEN',
    '  --location-id <locationId>                Export merged global + location view',
    '  --include-suggestions                     Also export suggestedPreferences diagnostics',
    '  --producer <label>                        Defaults to manual-or-export',
    '  --schema-mode open|known                  Defaults to open',
    '  --schema-reset-mode <mode>                none, fresh-user, archive-eval-owned, or baseline-only; defaults to none',
    '  --baseline-in <file>                      Read a pre-run definition baseline and diff against current definitions',
    '  --baseline-out <file>                     Write current definitions as a pre-run baseline',
    '  --run-id <id>',
  ].join('\n');
}

export function formatExportMemorySnapshotResult(result) {
  return result.lines.join('\n');
}

function authenticatedBackendUserId(responseData) {
  const actualUserId = responseData?.me?.userId;
  if (typeof actualUserId !== 'string' || actualUserId.length === 0) {
    throw new Error('GraphQL memory snapshot response did not include me.userId.');
  }
  return actualUserId;
}

function optionName(key) {
  return `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function generatedRunId(options, now) {
  return [
    'memory-snapshot',
    options.schemaMode,
    options.userId,
    options.corpusId,
    isoTimestamp(now).replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, ''),
  ].join('-');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runExportMemorySnapshot({ args: process.argv.slice(2) });
  console.log(formatExportMemorySnapshotResult(result));
  process.exitCode = result.exitCode;
}
