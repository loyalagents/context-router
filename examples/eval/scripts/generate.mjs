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
    out: null,
    regenerateIds: null,
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
        '--out',
        '--regenerate',
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
    if (arg === '--backend') options.backend = value;
    if (arg === '--model') options.model = value;
    if (arg === '--limit') options.limit = Number(value);
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
    regenerateIds: options.regenerateIds,
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
    const text = await provider(prompt, { doc, corpusPlan, profile, model });
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

function selectDocuments({ corpusPlan, outputRoot, limit, regenerateIds }) {
  let documents = [...(corpusPlan.documents ?? [])].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  if (regenerateIds) {
    const requested = new Set(regenerateIds);
    documents = documents.filter((doc) => requested.has(doc.id));
    const found = new Set(documents.map((doc) => doc.id));
    const missing = [...requested].filter((id) => !found.has(id));
    if (missing.length) {
      throw new Error(`Unknown document id(s) for --regenerate: ${missing.join(', ')}`);
    }
    return documents;
  }

  documents = documents.filter((doc) => !fileExistsSync(path.join(outputRoot, doc.path)));
  return limit == null ? documents : documents.slice(0, limit);
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
    '  pnpm eval:generate --user <userId> --corpus <corpusId> --backend vertex --model <model> --regenerate 017,042',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runGenerate({ args: process.argv.slice(2) });
  const output = formatResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
