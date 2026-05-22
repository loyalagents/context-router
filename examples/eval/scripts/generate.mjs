#!/usr/bin/env node

import { accessSync, constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  getFactValue,
  isFixtureId,
  jsonText,
  setNestedValue,
  toPosixPath,
} from './shared.mjs';
import { runValidation, formatResult as formatValidationResult } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

export async function runGenerate({
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
    const lines = await generateCorpus(repoRoot, parsed.options, {
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
    backend: 'vertex',
    model: null,
    limit: null,
    ids: null,
    out: null,
    regenerateIds: null,
    overwrite: false,
    concurrency: 1,
    temperature: 0.75,
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
        '--backend',
        '--model',
        '--limit',
        '--ids',
        '--out',
        '--regenerate',
        '--overwrite',
        '--concurrency',
        '--temperature',
      ].includes(arg)
    ) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }

    if (arg === '--overwrite') {
      options.overwrite = true;
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--backend') options.backend = value;
    if (arg === '--model') options.model = value;
    if (arg === '--limit') options.limit = Number(value);
    if (arg === '--ids') {
      options.ids = value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }
    if (arg === '--out') options.out = value;
    if (arg === '--regenerate') {
      options.regenerateIds = value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }
    if (arg === '--concurrency') options.concurrency = Number(value);
    if (arg === '--temperature') options.temperature = Number(value);
  }

  if (!options.userId || !isFixtureId(options.userId)) {
    return { kind: 'usage-error', message: '--user must be a fixture id.' };
  }
  if (!options.corpusId || !isFixtureId(options.corpusId)) {
    return { kind: 'usage-error', message: '--corpus must be a fixture id.' };
  }
  if (options.backend !== 'vertex') {
    return { kind: 'usage-error', message: '--backend currently supports only vertex.' };
  }
  if (options.limit != null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    return { kind: 'usage-error', message: '--limit must be a positive integer.' };
  }
  if (options.limit != null && !options.out) {
    return { kind: 'usage-error', message: '--limit requires --out so previews do not create partial corpora.' };
  }
  if (options.ids != null && options.ids.length === 0) {
    return { kind: 'usage-error', message: '--ids must list at least one document id.' };
  }
  if (options.ids != null && !options.out) {
    return { kind: 'usage-error', message: '--ids requires --out so previews do not create partial corpora.' };
  }
  if (options.ids != null && options.limit != null) {
    return { kind: 'usage-error', message: '--ids cannot be combined with --limit.' };
  }
  if (options.ids != null && options.regenerateIds != null) {
    return { kind: 'usage-error', message: '--ids cannot be combined with --regenerate.' };
  }
  if (options.overwrite && options.out) {
    return { kind: 'usage-error', message: '--overwrite writes the corpus in place and cannot be combined with --out.' };
  }
  if (options.overwrite && options.regenerateIds != null) {
    return { kind: 'usage-error', message: '--overwrite cannot be combined with --regenerate.' };
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
  if (result.errorMessage) return `eval generate failed\n\n${result.errorMessage}`;
  return ['eval generate passed', ...result.lines].join('\n');
}

async function generateCorpus(repoRoot, options, { env, generateDocument }) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', options.userId);
  const corpusRoot = path.join(userRoot, 'corpora', options.corpusId);
  const outputRoot = options.out ? path.resolve(repoRoot, options.out) : corpusRoot;
  const profile = parseYaml(await readFile(path.join(userRoot, 'profile.yaml'), 'utf8'));
  const corpusPlanPath = path.join(corpusRoot, 'corpus-plan.json');
  const corpusPlan = JSON.parse(await readFile(corpusPlanPath, 'utf8'));

  if (corpusPlan.userId !== options.userId || corpusPlan.corpusId !== options.corpusId) {
    throw new Error('corpus-plan.json userId/corpusId must match CLI arguments.');
  }

  const model = options.model ?? env.EVAL_GENERATION_MODEL;
  if (!model) {
    throw new Error('Set EVAL_GENERATION_MODEL or pass --model for generation.');
  }

  const selectedDocuments = selectDocuments({
    corpusPlan,
    outputRoot,
    limit: options.limit,
    ids: options.ids,
    regenerateIds: options.regenerateIds,
    overwrite: options.overwrite,
  });

  const provider =
    generateDocument ??
    ((prompt) =>
      generateWithVertex(prompt, {
        env,
        model,
        temperature: options.temperature,
      }));

  await runPool(selectedDocuments, options.concurrency, async (doc) => {
    const prompt = buildDocumentPrompt({ profile, corpusPlan, doc });
    const generatedText = await provider(prompt, { doc, corpusPlan, profile, model });
    const text = normalizeGeneratedText(generatedText, doc);
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error(`Generator returned empty text for document ${doc.id}.`);
    }
    const target = path.join(outputRoot, doc.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  });

  const lines = [
    `generated ${selectedDocuments.length} document(s)`,
    `model ${model}`,
    `output ${repoRelative(repoRoot, outputRoot)}`,
  ];

  if (options.out) return lines;

  const missing = [];
  for (const doc of corpusPlan.documents ?? []) {
    if (!(await fileExists(path.join(outputRoot, doc.path)))) missing.push(doc.id);
  }
  if (missing.length) {
    throw new Error(`Cannot write manifest until all planned document bodies exist. Missing ids: ${missing.join(', ')}`);
  }

  const manifestPath = path.join(corpusRoot, 'manifest.json');
  await writeFile(manifestPath, jsonText(manifestFromCorpusPlan(corpusPlan)), 'utf8');

  const validation = await runValidation({
    repoRoot,
    args: [
      '--user',
      options.userId,
      '--corpus',
      options.corpusId,
      '--write-report',
    ],
  });
  lines.push(...formatValidationResult(validation).split('\n'));
  if (validation.exitCode !== 0) {
    throw new Error(`Generated corpus failed validation:\n${formatValidationResult(validation)}`);
  }

  return lines;
}

export function buildDocumentPrompt({ profile, corpusPlan, doc }) {
  const profileSlice = {};
  for (const factKey of doc.factKeys ?? []) {
    setNestedValue(profileSlice, factKey, getFactValue(profile.facts ?? {}, factKey));
  }

  return [
    'You are writing one synthetic eval fixture document.',
    '',
    'Write only the document body. Do not include markdown fences or explanations.',
    fileTypeRules(doc),
    'Use only facts from the supplied profile slice unless the plan entry explicitly marks stale, conflicting, partial, redacted, third-party, or noise context.',
    'Do not invent canonical current facts.',
    'Place every listed fact key somewhere in the body.',
    'Do not write values for intentionally missing facts.',
    'Noise documents must contain no canonical user fact values.',
    'Stale or conflicting documents must make their stale/conflicting status clear.',
    '',
    'Corpus intentionally missing facts:',
    JSON.stringify(corpusPlan.intentionallyMissing ?? [], null, 2),
    '',
    'Profile slice:',
    JSON.stringify(profileSlice, null, 2),
    '',
    'Document plan entry:',
    JSON.stringify(doc, null, 2),
  ].join('\n');
}

export function normalizeGeneratedText(text, doc) {
  if (typeof text !== 'string') return text;
  const extension = doc.outputExtension ?? path.posix.extname(doc.path ?? '').slice(1);
  if (!['json', 'yaml', 'txt'].includes(extension)) return text;

  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json|ya?ml|txt|text)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1] : text;
}

export function manifestFromCorpusPlan(corpusPlan) {
  return {
    schemaVersion: 1,
    userId: corpusPlan.userId,
    corpusId: corpusPlan.corpusId,
    seed: `${corpusPlan.userId}__${corpusPlan.corpusId}`,
    forms: corpusPlan.forms ?? [],
    purpose: corpusPlan.purpose,
    intentionallyMissing: corpusPlan.intentionallyMissing ?? [],
    documents: (corpusPlan.documents ?? []).map((doc) => ({
      id: doc.id,
      path: doc.path,
      category: doc.category,
      title: doc.title,
      factKeys: doc.factKeys ?? [],
      detailTier: doc.detailTier,
      authority: doc.authority,
      freshness: doc.freshness,
      expectedUse: doc.expectedUse,
    })),
  };
}

function selectDocuments({
  corpusPlan,
  outputRoot,
  limit,
  ids,
  regenerateIds,
  overwrite,
}) {
  let documents = [...(corpusPlan.documents ?? [])].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  if (ids) {
    return resolveDocumentRefs(documents, ids, '--ids');
  }

  if (regenerateIds) {
    if (regenerateIds.length === 1 && regenerateIds[0] === 'all') {
      return documents;
    }
    return resolveDocumentRefs(documents, regenerateIds, '--regenerate');
  }

  if (overwrite) {
    return documents;
  }

  documents = documents.filter((doc) => !fileExistsSync(path.join(outputRoot, doc.path)));
  return limit == null ? documents : documents.slice(0, limit);
}

function resolveDocumentRefs(documents, refs, optionName) {
  const resolved = [];

  for (const ref of refs) {
    const matches = documents.filter((doc) => doc.id === ref || doc.id.endsWith(`-${ref}`));
    if (matches.length === 0) {
      throw new Error(`Unknown document id(s) for ${optionName}: ${ref}`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous document id for ${optionName}: ${ref}`);
    }
    resolved.push(matches[0]);
  }

  return resolved;
}

function fileTypeRules(doc) {
  const extension = doc.outputExtension ?? path.posix.extname(doc.path ?? '').slice(1);
  if (extension === 'json') {
    return [
      'Output format: valid JSON only.',
      'Do not wrap JSON in markdown fences.',
      'Do not include comments, trailing prose, or explanatory text outside the JSON value.',
    ].join('\n');
  }
  if (extension === 'yaml') {
    return [
      'Output format: valid YAML only.',
      'Do not wrap YAML in markdown fences.',
      'Do not include trailing prose or explanatory text outside the YAML document.',
    ].join('\n');
  }
  if (extension === 'txt') {
    return [
      'Output format: plain text only.',
      'Do not use markdown headings, markdown tables, bullet formatting, or markdown fences.',
      'Use realistic plain-text line breaks, labels, OCR-like spacing, or raw export text when appropriate.',
    ].join('\n');
  }
  return [
    'Output format: Markdown-compatible text.',
    'Avoid using the exact same section structure across documents unless the document genre requires it.',
  ].join('\n');
}

async function generateWithVertex(prompt, { env, model, temperature }) {
  if (!env.GCP_PROJECT_ID) {
    throw new Error('Set GCP_PROJECT_ID before using --backend vertex.');
  }
  const { VertexAI } = await import('@google-cloud/vertexai');
  const vertexAI = new VertexAI({
    project: env.GCP_PROJECT_ID ?? '',
    location: env.VERTEX_REGION ?? 'us-central1',
  });
  const generativeModel = vertexAI.getGenerativeModel({
    model,
    generationConfig: { temperature },
  });
  const result = await generativeModel.generateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  });
  return (result.response.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('');
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

function fileExistsSync(filePath) {
  try {
    accessSync(filePath, fsConstants.F_OK);
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
    '  pnpm eval:generate --user <userId> --corpus <corpusId> --backend vertex --model <model>',
    '  pnpm eval:generate --user <userId> --corpus <corpusId> --backend vertex --model <model> --limit 5 --out /private/tmp/preview',
    '  pnpm eval:generate --user <userId> --corpus <corpusId> --backend vertex --model <model> --ids 001,017 --out /private/tmp/preview',
    '  pnpm eval:generate --user <userId> --corpus <corpusId> --backend vertex --model <model> --regenerate 017,042',
    '  pnpm eval:generate --user <userId> --corpus <corpusId> --backend vertex --model <model> --overwrite',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runGenerate({ args: process.argv.slice(2) });
  const output = formatResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
