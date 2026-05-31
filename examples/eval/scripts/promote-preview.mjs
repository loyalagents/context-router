#!/usr/bin/env node

import {
  cp,
  copyFile,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestFromCorpusPlan } from './generate.mjs';
import { isFixtureId, jsonText, toPosixPath } from './shared.mjs';
import { formatResult as formatValidationResult, runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

export async function runPromotePreview({
  repoRoot = defaultRepoRoot,
  args = [],
  validate = runValidation,
} = {}) {
  const parsed = parseArgs(args);
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
    const lines = await promotePreview(repoRoot, parsed.options, { validate });
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

export function parseArgs(args) {
  const options = {
    userId: null,
    corpusId: null,
    from: null,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { kind: 'usage-error', message: usage() };
    }
    if (!['--user', '--corpus', '--from'].includes(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--from') options.from = value;
  }

  if (!options.userId || !isFixtureId(options.userId)) {
    return { kind: 'usage-error', message: '--user must be a fixture id.' };
  }
  if (!options.corpusId || !isFixtureId(options.corpusId)) {
    return { kind: 'usage-error', message: '--corpus must be a fixture id.' };
  }
  if (!options.from) {
    return { kind: 'usage-error', message: '--from is required.' };
  }

  return { kind: 'ok', options };
}

export function formatResult(result) {
  if (result.usageError) return `${result.usageError}\n\n${result.usage}`;
  if (result.errorMessage) return `eval promote-preview failed\n\n${result.errorMessage}`;
  return ['eval promote-preview passed', ...result.lines].join('\n');
}

async function promotePreview(repoRoot, options, { validate }) {
  const previewRoot = path.resolve(repoRoot, options.from);
  const corpusRoot = path.join(
    repoRoot,
    'examples/eval/users',
    options.userId,
    'corpora',
    options.corpusId,
  );
  const corpusPlanPath = path.join(corpusRoot, 'corpus-plan.json');
  const manifestPath = path.join(corpusRoot, 'manifest.json');
  const documentsRoot = path.join(corpusRoot, 'documents');
  const corpusPlan = JSON.parse(await readFile(corpusPlanPath, 'utf8'));

  if (corpusPlan.userId !== options.userId || corpusPlan.corpusId !== options.corpusId) {
    throw new Error('corpus-plan.json userId/corpusId must match CLI arguments.');
  }

  const previousManifest = await readExistingText(manifestPath);
  await mkdir(corpusRoot, { recursive: true });
  await writeFile(manifestPath, jsonText(manifestFromCorpusPlan(corpusPlan)), 'utf8');

  try {
    const previewValidation = await validate({
      repoRoot,
      args: [
        '--user',
        options.userId,
        '--corpus',
        options.corpusId,
        '--documents-root',
        previewRoot,
        '--report-out',
        path.join(previewRoot, 'promote-validation-report.json'),
      ],
    });
    if (previewValidation.exitCode !== 0) {
      throw new Error(`Preview validation failed:\n${formatValidationResult(previewValidation)}`);
    }

    if ((await directoryHasFiles(documentsRoot)) && !options.force) {
      throw new Error(
        `Refusing to overwrite existing document files under ${repoRelative(repoRoot, documentsRoot)}. Use --force to replace them.`,
      );
    }
  } catch (error) {
    await restoreText(manifestPath, previousManifest);
    throw error;
  }

  const previousDocuments = await snapshotDirectory(documentsRoot);
  const previousReport = await readExistingText(path.join(corpusRoot, 'validation-report.json'));
  let committedValidation = null;

  try {
    if (options.force) {
      await rm(documentsRoot, { recursive: true, force: true });
    }

    for (const doc of corpusPlan.documents ?? []) {
      const source = path.join(previewRoot, doc.path);
      const target = path.join(corpusRoot, doc.path);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }

    committedValidation = await validate({
      repoRoot,
      args: [
        '--user',
        options.userId,
        '--corpus',
        options.corpusId,
        '--write-report',
      ],
    });
    if (committedValidation.exitCode !== 0) {
      throw new Error(
        `Committed corpus validation failed after promotion:\n${formatValidationResult(committedValidation)}`,
      );
    }
  } catch (error) {
    try {
      await restoreText(manifestPath, previousManifest);
      await restoreText(path.join(corpusRoot, 'validation-report.json'), previousReport);
      await restoreDirectory(documentsRoot, previousDocuments);
    } finally {
      await cleanupSnapshot(previousDocuments);
    }
    throw error;
  }

  await cleanupSnapshot(previousDocuments);
  return [
    `promoted ${(corpusPlan.documents ?? []).length} document(s)`,
    `from ${repoRelative(repoRoot, previewRoot)}`,
    `to ${repoRelative(repoRoot, corpusRoot)}`,
    `report ${repoRelative(repoRoot, committedValidation.reportPath)}`,
  ];
}

async function directoryHasFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isFile() || entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && (await directoryHasFiles(absolute))) return true;
  }
  return false;
}

async function readExistingText(filePath) {
  try {
    return { exists: true, text: await readFile(filePath, 'utf8') };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, text: null };
    throw error;
  }
}

async function restoreText(filePath, snapshot) {
  if (snapshot.exists) {
    await writeFile(filePath, snapshot.text, 'utf8');
    return;
  }
  await rm(filePath, { force: true });
}

async function snapshotDirectory(directory) {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-promote-docs-'));
  const backupPath = path.join(tmpRoot, 'documents');
  try {
    await cp(directory, backupPath, { recursive: true });
    return { exists: true, tmpRoot, backupPath };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, tmpRoot, backupPath };
    await rm(tmpRoot, { recursive: true, force: true });
    throw error;
  }
}

async function restoreDirectory(directory, snapshot) {
  await rm(directory, { recursive: true, force: true });
  if (snapshot.exists) {
    await cp(snapshot.backupPath, directory, { recursive: true });
  }
}

async function cleanupSnapshot(snapshot) {
  await rm(snapshot.tmpRoot, { recursive: true, force: true });
}

function repoRelative(repoRoot, absolutePath) {
  return toPosixPath(path.relative(repoRoot, absolutePath));
}

function usage() {
  return [
    'Usage:',
    '  pnpm eval:promote-preview --user <userId> --corpus <corpusId> --from <previewRoot> [--force]',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runPromotePreview({ args: process.argv.slice(2) });
  const output = formatResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
