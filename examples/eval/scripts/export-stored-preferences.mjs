#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchStoredPreferencesGraphql } from './exporter/client.mjs';
import { buildStoredPreferencesArtifact } from './exporter/mapper.mjs';
import {
  relativePath,
  validateWithSchema,
  writeJson,
} from './scoring/io.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_GRAPHQL_URL = 'http://localhost:3000/graphql';

export async function runExportStoredPreferences({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const parsed = parseArgs(args, env);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  try {
    const responseData = await fetchStoredPreferencesGraphql({
      graphqlUrl: options.graphqlUrl,
      authToken: options.authToken,
      locationId: options.locationId,
      includeSuggestions: options.includeSuggestions,
      fetchImpl,
    });

    const artifact = buildStoredPreferencesArtifact({
      userId: options.userId,
      corpusId: options.corpusId,
      graphqlUrl: options.graphqlUrl,
      locationId: options.locationId,
      includeSuggestions: options.includeSuggestions,
      ingestionMode: options.ingestionMode,
      suggestionsWereAutoApplied: options.suggestionsWereAutoApplied,
      runId: options.runId,
      responseData,
      exportedAt: isoTimestamp(now),
    });

    await validateWithSchema(
      repoRoot,
      'stored-preferences.schema.json',
      artifact,
      'exported stored preferences',
    );

    const outPath = path.resolve(repoRoot, options.out);
    await writeJson(outPath, artifact);

    return {
      exitCode: 0,
      lines: [
        'eval export-stored-preferences passed',
        `active=${artifact.preferences.length} suggestions=${artifact.suggestions?.length ?? 0}`,
        `graphql ${options.graphqlUrl}`,
        `wrote ${relativePath(repoRoot, outPath)}`,
      ],
    };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [
        'eval export-stored-preferences failed',
        '',
        redactSecret(error?.stack ?? error?.message ?? String(error), options.authToken),
      ],
      error,
    };
  }
}

export function parseArgs(args, env = process.env) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    graphqlUrl: env.EVAL_GRAPHQL_URL || DEFAULT_GRAPHQL_URL,
    authToken: env.EVAL_AUTH_TOKEN,
    includeSuggestions: false,
  };

  const valueArgs = new Set([
    '--user',
    '--corpus',
    '--out',
    '--graphql-url',
    '--auth-token',
    '--location-id',
    '--ingestion-mode',
    '--suggestions-were-auto-applied',
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
    if (arg === '--out') options.out = value;
    if (arg === '--graphql-url') options.graphqlUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--location-id') options.locationId = value;
    if (arg === '--ingestion-mode') options.ingestionMode = value;
    if (arg === '--run-id') options.runId = value;
    if (arg === '--suggestions-were-auto-applied') {
      const parsed = parseBoolean(value, arg);
      if (parsed.kind === 'usage-error') return parsed;
      options.suggestionsWereAutoApplied = parsed.value;
    }
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

  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:export-stored-preferences --user <userId> --corpus <corpusId> --out <file> [options]',
    '',
    'Options:',
    '  --graphql-url <url>                       Defaults to EVAL_GRAPHQL_URL or http://localhost:3000/graphql',
    '  --auth-token <token>                      Defaults to EVAL_AUTH_TOKEN',
    '  --location-id <locationId>                Export merged global + location view',
    '  --include-suggestions                     Also export suggestedPreferences diagnostics',
    '  --ingestion-mode <label>                  Record storage input source',
    '  --suggestions-were-auto-applied true|false',
    '  --run-id <id>',
  ].join('\n');
}

export function formatExportStoredPreferencesResult(result) {
  return result.lines.join('\n');
}

function parseBoolean(value, arg) {
  if (value === 'true') return { kind: 'ok', value: true };
  if (value === 'false') return { kind: 'ok', value: false };
  return {
    kind: 'usage-error',
    message: `Expected ${arg} to be true or false`,
  };
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

function redactSecret(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('[redacted-auth-token]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runExportStoredPreferences({ args: process.argv.slice(2) });
  console.log(formatExportStoredPreferencesResult(result));
  process.exitCode = result.exitCode;
}
