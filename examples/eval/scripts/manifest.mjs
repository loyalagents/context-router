#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFixtureId, jsonText } from './shared.mjs';
import { manifestFromCorpusPlan } from './generate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

export async function runManifest({
  repoRoot = defaultRepoRoot,
  args = [],
} = {}) {
  const parsed = parseManifestArgs(args);
  if (parsed.kind === 'usage-error') {
    return {
      exitCode: 2,
      repoRoot,
      usageError: parsed.message,
      usage: usage(),
      lines: [],
    };
  }

  try {
    const lines = await writeManifest(repoRoot, parsed.options);
    return { exitCode: 0, repoRoot, lines };
  } catch (error) {
    return {
      exitCode: 1,
      repoRoot,
      lines: [],
      errorMessage: error.message,
    };
  }
}

export function parseManifestArgs(args) {
  const options = {
    userId: null,
    corpusId: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      return { kind: 'usage-error', message: usage() };
    }
    if (!['--user', '--corpus'].includes(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
  }

  if (!options.userId || !isFixtureId(options.userId)) {
    return { kind: 'usage-error', message: '--user must be a fixture id.' };
  }
  if (!options.corpusId || !isFixtureId(options.corpusId)) {
    return { kind: 'usage-error', message: '--corpus must be a fixture id.' };
  }

  return { kind: 'ok', options };
}

export function formatManifestResult(result) {
  if (result.usageError) return `${result.usageError}\n\n${result.usage}`;
  if (result.errorMessage) return `eval manifest failed\n\n${result.errorMessage}`;
  return ['eval manifest passed', ...result.lines].join('\n');
}

async function writeManifest(repoRoot, options) {
  const corpusRoot = path.join(
    repoRoot,
    'examples/eval/users',
    options.userId,
    'corpora',
    options.corpusId,
  );
  const corpusPlanPath = path.join(corpusRoot, 'corpus-plan.json');
  const corpusPlan = JSON.parse(await readFile(corpusPlanPath, 'utf8'));

  if (corpusPlan.userId !== options.userId || corpusPlan.corpusId !== options.corpusId) {
    throw new Error('corpus-plan.json userId/corpusId must match CLI arguments.');
  }

  const manifestPath = path.join(corpusRoot, 'manifest.json');
  await writeFile(manifestPath, jsonText(manifestFromCorpusPlan(corpusPlan)), 'utf8');

  return [
    `wrote ${path.relative(repoRoot, manifestPath)}`,
    `documents ${(corpusPlan.documents ?? []).length}`,
  ];
}

function usage() {
  return [
    'Usage:',
    '  pnpm eval:manifest --user <userId> --corpus <corpusId>',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runManifest({ args: process.argv.slice(2) });
  const output = formatManifestResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
