#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  buildDocumentPrompt,
  generateWithVertex,
  normalizeGeneratedText,
} from './generate.mjs';
import { isFixtureId, jsonText, toPosixPath } from './shared.mjs';
import { formatResult as formatValidationResult, runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

export async function runRepairGeneration({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  generateDocument = null,
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
    const lines = await repairGeneration(repoRoot, parsed.options, {
      env,
      generateDocument,
    });
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
    backend: 'vertex',
    model: null,
    maxAttempts: 3,
    concurrency: 1,
    temperature: 0.4,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      return { kind: 'usage-error', message: usage() };
    }
    if (
      ![
        '--user',
        '--corpus',
        '--from',
        '--backend',
        '--model',
        '--max-attempts',
        '--concurrency',
        '--temperature',
      ].includes(arg)
    ) {
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
    if (arg === '--backend') options.backend = value;
    if (arg === '--model') options.model = value;
    if (arg === '--max-attempts') options.maxAttempts = Number(value);
    if (arg === '--concurrency') options.concurrency = Number(value);
    if (arg === '--temperature') options.temperature = Number(value);
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
  if (options.backend !== 'vertex') {
    return { kind: 'usage-error', message: '--backend currently supports only vertex.' };
  }
  if (
    !Number.isInteger(options.maxAttempts) ||
    options.maxAttempts < 1 ||
    options.maxAttempts > 10
  ) {
    return { kind: 'usage-error', message: '--max-attempts must be an integer from 1 to 10.' };
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 8
  ) {
    return { kind: 'usage-error', message: '--concurrency must be an integer from 1 to 8.' };
  }
  if (
    typeof options.temperature !== 'number' ||
    Number.isNaN(options.temperature) ||
    options.temperature < 0 ||
    options.temperature > 2
  ) {
    return { kind: 'usage-error', message: '--temperature must be a number from 0 to 2.' };
  }

  return { kind: 'ok', options };
}

export function formatResult(result) {
  if (result.usageError) return `${result.usageError}\n\n${result.usage}`;
  if (result.errorMessage) {
    return `eval repair-generation failed\n\n${result.errorMessage}`;
  }
  return ['eval repair-generation passed', ...result.lines].join('\n');
}

async function repairGeneration(repoRoot, options, { env, generateDocument }) {
  const previewRoot = path.resolve(repoRoot, options.from);
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', options.userId);
  const corpusRoot = path.join(userRoot, 'corpora', options.corpusId);
  const profile = parseYaml(await readFile(path.join(userRoot, 'profile.yaml'), 'utf8'));
  const corpusPlan = JSON.parse(
    await readFile(path.join(corpusRoot, 'corpus-plan.json'), 'utf8'),
  );
  const manifest = JSON.parse(await readFile(path.join(corpusRoot, 'manifest.json'), 'utf8'));
  const model = options.model ?? env.EVAL_GENERATION_MODEL;

  if (!model) {
    throw new Error('Set EVAL_GENERATION_MODEL or pass --model for repair generation.');
  }

  const provider =
    generateDocument ??
    ((prompt) =>
      generateWithVertex(prompt, {
        env,
        model,
        temperature: options.temperature,
      }));

  const attempts = [];
  const repairedDocumentIds = new Set();
  let repairRoundsRun = 0;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const validation = await validatePreview(repoRoot, options, previewRoot);
    const { failedDocs, repairableIssueIndexes } = groupRepairableIssues(
      validation.issues,
      manifest,
      corpusPlan,
    );
    const unrepairableBlockingIssues = getUnrepairableBlockingIssues(
      validation.issues,
      repairableIssueIndexes,
    );
    attempts.push({
      attempt,
      phase: 'pre-repair-validation',
      status: validation.exitCode === 0 ? 'pass' : 'fail',
      failedDocumentIds: failedDocs.map((entry) => entry.doc.id),
      unrepairableIssueCount:
        validation.issues.length -
        failedDocs.reduce((sum, entry) => sum + entry.issues.length, 0),
    });

    if (validation.exitCode === 0) {
      await writeRepairReport(previewRoot, {
        status: 'pass',
        attempts,
        repairedDocumentIds: [...repairedDocumentIds].sort(),
        validation,
      });
      return [
        `preview validation passed after ${attempt - 1} repair attempt(s)`,
        `preview ${repoRelative(repoRoot, previewRoot)}`,
        `report ${repoRelative(repoRoot, path.join(previewRoot, 'repair-report.json'))}`,
      ];
    }

    if (unrepairableBlockingIssues.length > 0) {
      throw new Error(
        `Preview validation failed with non-repairable issues:\n${formatValidationResult(validation)}`,
      );
    }

    if (failedDocs.length === 0) {
      throw new Error(
        `Preview validation failed without document-scoped repairable issues:\n${formatValidationResult(validation)}`,
      );
    }

    await runPool(failedDocs, options.concurrency, async ({ doc, issues }) => {
      repairedDocumentIds.add(doc.id);
      const prompt = await buildRepairPrompt({
        profile,
        corpusPlan,
        doc,
        issues,
        previewRoot,
        attempt,
      });
      const generatedText = await provider(prompt, {
        doc,
        corpusPlan,
        profile,
        model,
        repairIssues: issues,
        attempt,
      });
      const text = normalizeGeneratedText(generatedText, doc);
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error(`Generator returned empty text for document ${doc.id}.`);
      }
      const target = path.join(previewRoot, doc.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    });
    repairRoundsRun = attempt;
  }

  const finalValidation = await validatePreview(repoRoot, options, previewRoot);
  const {
    failedDocs: finalFailedDocs,
    repairableIssueIndexes: finalRepairableIssueIndexes,
  } = groupRepairableIssues(finalValidation.issues, manifest, corpusPlan);
  attempts.push({
    attempt: options.maxAttempts,
    phase: 'post-repair-validation',
    status: finalValidation.exitCode === 0 ? 'pass' : 'fail',
    failedDocumentIds: finalFailedDocs.map((entry) => entry.doc.id),
    unrepairableIssueCount:
      finalValidation.issues.length -
      finalFailedDocs.reduce((sum, entry) => sum + entry.issues.length, 0),
  });
  const finalUnrepairableBlockingIssues = getUnrepairableBlockingIssues(
    finalValidation.issues,
    finalRepairableIssueIndexes,
  );
  await writeRepairReport(previewRoot, {
    status: finalValidation.exitCode === 0 ? 'pass' : 'fail',
    attempts,
    repairedDocumentIds: [...repairedDocumentIds].sort(),
    validation: finalValidation,
  });

  if (finalUnrepairableBlockingIssues.length > 0) {
    throw new Error(
      `Preview validation failed with non-repairable issues:\n${formatValidationResult(finalValidation)}`,
    );
  }

  if (finalValidation.exitCode !== 0) {
    throw new Error(
      `Preview still failed after ${options.maxAttempts} repair attempt(s):\n${formatValidationResult(finalValidation)}`,
    );
  }

  return [
    `preview validation passed after ${repairRoundsRun} repair attempt(s)`,
    `preview ${repoRelative(repoRoot, previewRoot)}`,
    `report ${repoRelative(repoRoot, path.join(previewRoot, 'repair-report.json'))}`,
    `errors ${finalValidation.summary.errors}`,
  ];
}

async function validatePreview(repoRoot, options, previewRoot) {
  return runValidation({
    repoRoot,
    args: [
      '--user',
      options.userId,
      '--corpus',
      options.corpusId,
      '--documents-root',
      previewRoot,
      '--report-out',
      path.join(previewRoot, 'validation-report.json'),
    ],
  });
}

function groupRepairableIssues(issues, manifest, corpusPlan) {
  const planDocById = new Map((corpusPlan.documents ?? []).map((doc) => [doc.id, doc]));
  const planDocByPath = new Map((corpusPlan.documents ?? []).map((doc) => [doc.path, doc]));
  const entries = (manifest.documents ?? []).map((manifestDoc) => {
    const planDoc = planDocById.get(manifestDoc.id) ?? planDocByPath.get(manifestDoc.path);
    if (!planDoc) {
      throw new Error(
        `Manifest document ${manifestDoc.id ?? manifestDoc.path} does not match any corpus-plan document. Regenerate manifest.json from corpus-plan.json before repairing.`,
      );
    }
    return {
      manifestDoc,
      doc: planDoc,
      issues: [],
    };
  });
  const byId = new Map(entries.map((entry) => [entry.manifestDoc.id, entry]));
  const byIndex = new Map(entries.map((entry, index) => [String(index), entry]));
  const repairableIssueIndexes = new Set();

  for (const [issueIndex, issue] of issues.entries()) {
    const pointerMatch = issue.pointer?.match(/^\/documents\/(\d+)(?:\/|$)/);
    let entry = pointerMatch ? byIndex.get(pointerMatch[1]) : null;
    if (!entry) {
      const messageMatch = issue.message?.match(/^Document ([^\s]+) /);
      entry = messageMatch ? byId.get(messageMatch[1]) : null;
    }
    if (!entry) continue;
    if (!isRepairableDocumentIssue(issue)) continue;
    entry.issues.push({
      code: issue.code,
      level: issue.level,
      pointer: issue.pointer,
      message: issue.message,
      fix: issue.fix,
    });
    repairableIssueIndexes.add(issueIndex);
  }

  return {
    failedDocs: entries.filter((entry) => entry.issues.length > 0),
    repairableIssueIndexes,
  };
}

function isRepairableDocumentIssue(issue) {
  return (
    issue.code === 'DOCUMENT_PATH_MISSING' ||
    issue.code === 'DOCUMENT_FACT_VALUE_MISSING' ||
    issue.code === 'DOCUMENT_FORBIDDEN_FACT_PRESENT' ||
    issue.code === 'DOCUMENT_MISSING_FACT_PRESENT' ||
    issue.code === 'DOCUMENT_MARKDOWN_FENCE' ||
    issue.code === 'DOCUMENT_JSON_INVALID' ||
    issue.code === 'DOCUMENT_YAML_INVALID' ||
    issue.code === 'DOCUMENT_TXT_MARKDOWN_STYLE' ||
    issue.code === 'DOCUMENT_THIN'
  );
}

function getUnrepairableBlockingIssues(issues, repairableIssueIndexes) {
  return issues.filter(
    (issue, issueIndex) =>
      issue.level === 'error' && !repairableIssueIndexes.has(issueIndex),
  );
}

async function buildRepairPrompt({
  profile,
  corpusPlan,
  doc,
  issues,
  previewRoot,
  attempt,
}) {
  const basePrompt = buildDocumentPrompt({ profile, corpusPlan, doc });
  const existingPath = path.join(previewRoot, doc.path);
  const previousBody = (await fileExists(existingPath))
    ? await readFile(existingPath, 'utf8')
    : '';

  return [
    basePrompt,
    '',
    'Repair feedback:',
    `This is repair attempt ${attempt}. Rewrite the same document so it satisfies the validation issues below.`,
    'Preserve the document genre and output format. Return only the replacement document body.',
    '',
    'Validation issues:',
    JSON.stringify(issues, null, 2),
    '',
    'Previous body:',
    previousBody || '(missing document body)',
  ].join('\n');
}

async function writeRepairReport(previewRoot, {
  status,
  attempts,
  repairedDocumentIds,
  validation,
}) {
  const reportPath = path.join(previewRoot, 'repair-report.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    jsonText({
      schemaVersion: 1,
      status,
      attempts,
      repairedDocumentIds,
      validationSummary: validation.summary,
      remainingIssues: status === 'pass' ? [] : validation.issues,
    }),
    'utf8',
  );
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function repoRelative(repoRoot, absolutePath) {
  return toPosixPath(path.relative(repoRoot, absolutePath));
}

function usage() {
  return [
    'Usage:',
    '  pnpm eval:repair-generation --user <userId> --corpus <corpusId> --from <previewRoot> --backend vertex [--model <model>] [--max-attempts 3] [--concurrency 1]',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runRepairGeneration({ args: process.argv.slice(2) });
  const output = formatResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
