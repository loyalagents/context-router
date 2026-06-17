#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreDatabaseToFile } from './scoring/database.mjs';
import { scoreFormToFile } from './scoring/form.mjs';
import { scoreCombinedToFile } from './scoring/combined.mjs';
import { scoreOpenSchemaDatabaseToFile } from './scoring/open-schema-database.mjs';
import { scoreOpenSchemaCombinedToFile } from './scoring/open-schema-combined.mjs';

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

    if (options.mode === 'combined') {
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
    }

    if (options.mode === 'open-schema-database') {
      const report = await scoreOpenSchemaDatabaseToFile({
        repoRoot,
        userId: options.userId,
        corpusId: options.corpusId,
        memorySnapshotPath: path.resolve(repoRoot, options.memorySnapshot),
        validationReportPath: options.validationReport
          ? path.resolve(repoRoot, options.validationReport)
          : undefined,
        outPath: path.resolve(repoRoot, options.out),
      });
      return {
        exitCode: report.fixtureReadiness.scorable ? 0 : 1,
        lines: [
          `eval score open-schema-database ${report.fixtureReadiness.scorable ? 'passed' : 'unscorable'}`,
          `known=${report.summary.knownPresentTotal} missing=${report.summary.intentionallyMissingTotal}`,
          `wrote ${path.relative(repoRoot, path.resolve(repoRoot, options.out))}`,
        ],
      };
    }

    const report = await scoreOpenSchemaCombinedToFile({
      repoRoot,
      openSchemaDatabaseReportPath: path.resolve(repoRoot, options.openSchemaDatabaseReport),
      formReportPath: path.resolve(repoRoot, options.formReport),
      outPath: path.resolve(repoRoot, options.out),
    });
    return {
      exitCode: 0,
      lines: [
        'eval score open-schema-combined passed',
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
        '--memory-snapshot',
        '--validation-report',
        '--scenario',
        '--filled-form',
        '--database-report',
        '--open-schema-database-report',
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
    if (arg === '--memory-snapshot') options.memorySnapshot = value;
    if (arg === '--validation-report') options.validationReport = value;
    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--filled-form') options.filledForm = value;
    if (arg === '--database-report') options.databaseReport = value;
    if (arg === '--open-schema-database-report') options.openSchemaDatabaseReport = value;
    if (arg === '--form-report') options.formReport = value;
    if (arg === '--out') options.out = value;
  }

  if (
    ![
      'database',
      'form',
      'combined',
      'open-schema-database',
      'open-schema-combined',
    ].includes(options.mode)
  ) {
    return {
      kind: 'usage-error',
      message: 'Expected --mode database, form, combined, open-schema-database, or open-schema-combined',
    };
  }
  if (!options.out) {
    return { kind: 'usage-error', message: 'Missing required --out' };
  }
  if (options.mode === 'database') {
    return requireOptions(options, ['userId', 'corpusId', 'storedPreferences']);
  }
  if (options.mode === 'open-schema-database') {
    return requireOptions(options, ['userId', 'corpusId', 'memorySnapshot']);
  }
  if (options.mode === 'form') {
    return requireOptions(options, ['scenarioId', 'filledForm']);
  }
  if (options.mode === 'combined') {
    return requireOptions(options, ['databaseReport', 'formReport']);
  }
  return requireOptions(options, ['openSchemaDatabaseReport', 'formReport']);
}

function requireOptions(options, required) {
  for (const key of required) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${optionNameForKey(key)}` };
    }
  }
  return { kind: 'ok', options };
}

function optionNameForKey(key) {
  return {
    userId: '--user',
    corpusId: '--corpus',
    storedPreferences: '--stored-preferences',
    memorySnapshot: '--memory-snapshot',
    scenarioId: '--scenario',
    filledForm: '--filled-form',
    databaseReport: '--database-report',
    openSchemaDatabaseReport: '--open-schema-database-report',
    formReport: '--form-report',
  }[key];
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:score --mode database --user <userId> --corpus <corpusId> --stored-preferences <file> [--validation-report <file>] --out <file>',
    '  pnpm eval:score --mode form --scenario <scenarioId> --filled-form <file> --out <file>',
    '  pnpm eval:score --mode combined --database-report <file> --form-report <file> --out <file>',
    '  pnpm eval:score --mode open-schema-database --user <userId> --corpus <corpusId> --memory-snapshot <file> [--validation-report <file>] --out <file>',
    '  pnpm eval:score --mode open-schema-combined --open-schema-database-report <file> --form-report <file> --out <file>',
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
