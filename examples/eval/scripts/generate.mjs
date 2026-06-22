#!/usr/bin/env node

import { accessSync, constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  effectiveForbiddenFactKeys,
  getFactValue,
  isFixtureId,
  planDocumentFactKeys,
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
  const manifestPath = path.join(corpusRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (manifest.userId !== options.userId || manifest.corpusId !== options.corpusId) {
    throw new Error('manifest.json userId/corpusId must match CLI arguments.');
  }

  const model = options.model ?? env.EVAL_GENERATION_MODEL;
  if (!model) {
    throw new Error('Set EVAL_GENERATION_MODEL or pass --model for generation.');
  }

  const selectedDocuments = selectDocuments({
    corpus: manifest,
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
    const prompt = buildDocumentPrompt({ profile, corpusPlan: manifest, doc });
    const generatedText = await provider(prompt, { doc, corpusPlan: manifest, profile, model });
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
  for (const doc of manifest.documents ?? []) {
    if (!(await fileExists(path.join(outputRoot, doc.path)))) missing.push(doc.id);
  }
  if (missing.length) {
    throw new Error(`Cannot validate generated corpus until all manifest document bodies exist. Missing ids: ${missing.join(', ')}`);
  }

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
  for (const factKey of planDocumentFactKeys(doc)) {
    setNestedValue(profileSlice, factKey, getFactValue(profile.facts ?? {}, factKey));
  }
  const forbiddenFactKeys = effectiveForbiddenFactKeys(corpusPlan, doc);
  const forbiddenProfileSlice = {};
  for (const factKey of forbiddenFactKeys) {
    const value = getFactValue(profile.facts ?? {}, factKey);
    if (value != null) setNestedValue(forbiddenProfileSlice, factKey, value);
  }

  const sourceWorld = sliceArtifactWorld(corpusPlan.artifactWorld ?? {}, doc.sourceSpec?.worldRefs ?? []);
  const timeline = sliceArtifactWorld(
    corpusPlan.artifactWorld ?? {},
    (doc.sourceSpec?.timelineRefs ?? []).map((ref) => `timeline.${ref}`),
  );
  const intentionallyMissingFactKeys = [
    ...new Set(
      (corpusPlan.intentionallyMissing ?? [])
        .map((entry) => entry?.factKey)
        .filter((factKey) => typeof factKey === 'string' && factKey.length > 0),
    ),
  ].sort();

  return [
    'Write the captured body of this source artifact.',
    '',
    'Return only the artifact body. Do not include markdown fences or explanatory wrapper text.',
    fileTypeRules(doc),
    sourceFormatRules(doc),
    'Make the body look native to the source family and capture mode.',
    'Use the allowed source context only for incidental source metadata.',
    'Do not add new personal details for the user.',
    'Include each required person detail in a natural place for this artifact.',
    'Do not include excluded person-detail values.',
    'For absent person details, omit the detail unless this source has a native field for it; then use only the native blank/null value.',
    'Do not comment on, explain, or justify absent person details.',
    'Noise artifacts must not contain user-specific current identifiers.',
    'Stale or conflicting artifacts must make their stale, superseded, or do-not-use status clear.',
    '',
    'Artifact source spec:',
    JSON.stringify(doc.sourceSpec ?? {}, null, 2),
    '',
    'Evaluation role:',
    JSON.stringify(doc.evaluationRole ?? {}, null, 2),
    '',
    'Allowed source context:',
    JSON.stringify({ ...sourceWorld, ...timeline }, null, 2),
    '',
    'Intentionally absent person-detail paths:',
    JSON.stringify(intentionallyMissingFactKeys, null, 2),
    '',
    'Required person details:',
    JSON.stringify(profileSlice, null, 2),
    '',
    'Excluded person-detail paths:',
    JSON.stringify(forbiddenFactKeys, null, 2),
    '',
    'Excluded person-detail values:',
    JSON.stringify(forbiddenProfileSlice, null, 2),
  ].join('\n');
}

function sliceArtifactWorld(artifactWorld, refs) {
  const slice = {};
  for (const ref of refs) {
    const value = getWorldValue(artifactWorld, ref);
    if (value !== undefined) setNestedValue(slice, ref, value);
  }
  return slice;
}

function getWorldValue(artifactWorld, ref) {
  return ref.split('.').reduce((value, segment) => {
    if (value == null || typeof value !== 'object') return undefined;
    return value[segment];
  }, artifactWorld);
}

export function normalizeGeneratedText(text, doc) {
  if (typeof text !== 'string') return text;
  const extension = doc.outputExtension ?? path.posix.extname(doc.path ?? '').slice(1);
  if (!['json', 'yaml', 'txt'].includes(extension)) return text;

  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json|ya?ml|txt|text)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1] : text;
}

function selectDocuments({
  corpus,
  outputRoot,
  limit,
  ids,
  regenerateIds,
  overwrite,
}) {
  let documents = [...(corpus.documents ?? [])].sort((left, right) =>
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
      'Quote YAML scalar strings that contain colons, braces, brackets, leading special characters, or values that could otherwise be parsed incorrectly.',
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

function sourceFormatRules(doc) {
  const lines = [
    'When sourceSpec.lengthTarget is present, aim to keep the body within its minChars/maxChars range.',
    'Email artifacts must use raw email headers exactly like From:, To:, Date:, and Subject:, not Markdown-bold header labels.',
    'OCR and plain-text exports should use native label/value lines, OCR-like blocks, or raw export text instead of Markdown headings or bold labels.',
    'JSON and YAML exports should use native field ids or keys and avoid comments; put explanatory notes in native fields such as notes, reviewer_notes, or status_history[].note.',
    'Use provided timeline values for the artifact primary source, export, created, or submitted timestamp when applicable. Additional operational timestamps, status rows, support notes, and source-system metadata may be added for realism when they are clearly incidental, chronologically plausible, within any sourceSpec temporal bounds or time ranges, and do not change freshness, authority, stale/current interpretation, or provide competing values for target form fields.',
    'Invented details are allowed only as incidental operational metadata; do not invent values that could plausibly fill a target form field or update the current employee profile. For those fields, use Required person details, Allowed source context, native blank/null/not_imported values, or omit the field.',
    'Do not synthesize plausible values for missing canonical profile facts such as employer name, employer address, job title, department, start date, phone, tax elections, work authorization values, or banking values. If the value is not in Required person details or Allowed source context, leave it blank/null/not_imported or omit it.',
    'Treat sourceSpec.safeDetailMenu as allowed construction guidance and sourceSpec.riskyDetailMenu as disallowed drift. When a safe or risky detail names temporal, state, or optional-field bounds, follow those bounds strictly.',
    'Native source artifacts may include fields beyond the required person details, but user-person fields not present in Required person details or Allowed source context must stay blank, null, or not_imported; do not supply factual defaults such as false, 0, unknown, or placeholder old values.',
  ];

  if (planDocumentFactKeys(doc).includes('identity.legalName')) {
    lines.push(
      'Because identity.legalName is required, include either a native combined legal-name field or clearly labeled first/middle/last name fields.',
    );
  }

  return lines.join('\n');
}

export async function generateWithVertex(prompt, { env, model, temperature }) {
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
