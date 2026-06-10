#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreDatabaseToFile } from './scoring/database.mjs';
import { scoreFormToFile } from './scoring/form.mjs';
import { scoreCombinedToFile } from './scoring/combined.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

export async function runScore({ repoRoot = defaultRepoRoot, args = [] } = {}) {
  const parsed = parseArgs(args);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  try {
    const options = parsed.options;
    if (options.mode === 'database') {
      const report = await scoreDatabaseToFile({
        repoRoot,
        userId: options.userId,
        corpusId: options.corpusId,
        storedPreferencesPath: path.resolve(repoRoot, options.storedPreferences),
        validationReportPath: options.validationReport
          ? path.resolve(repoRoot, options.validationReport)
          : undefined,
        outPath: path.resolve(repoRoot, options.out),
      });
      return {
        exitCode: report.fixtureReadiness.scorable ? 0 : 1,
        lines: [
          `eval score database ${report.fixtureReadiness.scorable ? 'passed' : 'unscorable'}`,
          `known=${report.summary.knownPresentTotal} missing=${report.summary.intentionallyMissingTotal}`,
          `wrote ${path.relative(repoRoot, path.resolve(repoRoot, options.out))}`,
        ],
      };
    }

    if (options.mode === 'form') {
      const report = await scoreFormToFile({
        repoRoot,
        scenarioId: options.scenarioId,
        filledFormPath: path.resolve(repoRoot, options.filledForm),
        outPath: path.resolve(repoRoot, options.out),
      });
      return {
        exitCode: 0,
        lines: [
          'eval score form passed',
          `known=${report.summary.knownFieldTotal} abstention=${report.summary.abstentionFieldTotal}`,
          `wrote ${path.relative(repoRoot, path.resolve(repoRoot, options.out))}`,
        ],
      };
    }

    const report = await scoreCombinedToFile({
      repoRoot,
      databaseReportPath: path.resolve(repoRoot, options.databaseReport),
      formReportPath: path.resolve(repoRoot, options.formReport),
      outPath: path.resolve(repoRoot, options.out),
    });
    return {
      exitCode: 0,
      lines: [
        'eval score combined passed',
        `facts=${report.summary.factTotal}`,
        `wrote ${path.relative(repoRoot, path.resolve(repoRoot, options.out))}`,
      ],
    };
  } catch (error) {
    return {
      exitCode: 1,
      lines: ['eval score failed', '', error?.stack ?? error?.message ?? String(error)],
      error,
    };
  }
}

export function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (
      ![
        '--mode',
        '--user',
        '--corpus',
        '--stored-preferences',
        '--validation-report',
        '--scenario',
        '--filled-form',
        '--database-report',
        '--form-report',
        '--out',
      ].includes(arg)
    ) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;
    if (arg === '--mode') options.mode = value;
    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--stored-preferences') options.storedPreferences = value;
    if (arg === '--validation-report') options.validationReport = value;
    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--filled-form') options.filledForm = value;
    if (arg === '--database-report') options.databaseReport = value;
    if (arg === '--form-report') options.formReport = value;
    if (arg === '--out') options.out = value;
  }

  if (!['database', 'form', 'combined'].includes(options.mode)) {
    return {
      kind: 'usage-error',
      message: 'Expected --mode database, --mode form, or --mode combined',
    };
  }
  if (!options.out) {
    return { kind: 'usage-error', message: 'Missing required --out' };
  }
  if (options.mode === 'database') {
    return requireOptions(options, ['userId', 'corpusId', 'storedPreferences']);
  }
  if (options.mode === 'form') {
    return requireOptions(options, ['scenarioId', 'filledForm']);
  }
  return requireOptions(options, ['databaseReport', 'formReport']);
}

function requireOptions(options, required) {
  for (const key of required) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${optionName(key)}` };
    }
  }
  return { kind: 'ok', options };
}

function optionName(key) {
  return `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:score --mode database --user <userId> --corpus <corpusId> --stored-preferences <file> [--validation-report <file>] --out <file>',
    '  pnpm eval:score --mode form --scenario <scenarioId> --filled-form <file> --out <file>',
    '  pnpm eval:score --mode combined --database-report <file> --form-report <file> --out <file>',
  ].join('\n');
}

export function formatScoreResult(result) {
  return result.lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runScore({ args: process.argv.slice(2) });
  console.log(formatScoreResult(result));
  process.exitCode = result.exitCode;
}
