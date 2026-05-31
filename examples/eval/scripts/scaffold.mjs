#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runValidation, formatResult as formatValidationResult } from './validate.mjs';
import {
  classifyFactKey,
  collectFactKeys,
  deriveSeedPreferences,
  getFactValue,
  hashInt,
  isFixtureId,
  jsonText,
  SEED_PATTERN,
  setNestedValue,
  toPosixPath,
} from './shared.mjs';
import { discoverTemplates, renderTemplate } from './template-renderer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

const MISSING_REASON =
  'This profile fact is explicitly null and intentionally absent from rendered documents.';
const MISSING_EXPECTED_BEHAVIOR =
  'Leave the field blank; do not guess or synthesize a value.';

export async function runScaffold({
  repoRoot = defaultRepoRoot,
  args = [],
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
    if (parsed.options.initUser) {
      const lines = await initUser(repoRoot, parsed.options);
      return { exitCode: 0, repoRoot, lines };
    }

    const lines = await renderCorpus(repoRoot, parsed.options);
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
    initUser: false,
    userId: null,
    displayName: null,
    corpusId: null,
    formIds: [],
    count: null,
    seed: null,
    missingFactKeys: [],
    scenarioId: null,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--init-user') {
      options.initUser = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { kind: 'usage-error', message: usage() };
    }
    if (
      ![
        '--user',
        '--display-name',
        '--corpus',
        '--form',
        '--count',
        '--seed',
        '--missing',
        '--scenario',
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
    if (arg === '--display-name') options.displayName = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--form') options.formIds.push(value);
    if (arg === '--count') options.count = Number(value);
    if (arg === '--seed') options.seed = value;
    if (arg === '--missing') options.missingFactKeys.push(value);
    if (arg === '--scenario') options.scenarioId = value;
  }

  if (!options.userId || !isFixtureId(options.userId)) {
    return { kind: 'usage-error', message: '--user must be a fixture id.' };
  }
  if (options.formIds.length === 0) {
    return { kind: 'usage-error', message: 'At least one --form is required.' };
  }
  for (const formId of options.formIds) {
    if (!isFixtureId(formId)) {
      return { kind: 'usage-error', message: '--form values must be fixture ids.' };
    }
  }
  if (options.scenarioId && !isFixtureId(options.scenarioId)) {
    return { kind: 'usage-error', message: '--scenario must be a fixture id.' };
  }
  if (options.scenarioId && options.formIds.length !== 1) {
    return { kind: 'usage-error', message: '--scenario requires exactly one --form.' };
  }
  if (options.count != null && (!Number.isInteger(options.count) || options.count < 1)) {
    return { kind: 'usage-error', message: '--count must be a positive integer.' };
  }
  if (options.seed && !SEED_PATTERN.test(options.seed)) {
    return {
      kind: 'usage-error',
      message: '--seed must match /^[a-z0-9_-]+$/.',
    };
  }

  if (options.initUser) {
    if (!options.displayName) {
      return { kind: 'usage-error', message: '--init-user requires --display-name.' };
    }
    if (options.corpusId || options.scenarioId || options.count != null) {
      return {
        kind: 'usage-error',
        message: '--init-user does not accept --corpus, --scenario, or --count.',
      };
    }
  } else if (!options.corpusId || !isFixtureId(options.corpusId)) {
    return { kind: 'usage-error', message: 'Render mode requires --corpus.' };
  }

  options.formIds = [...new Set(options.formIds)].sort();
  options.missingFactKeys = [...new Set(options.missingFactKeys)].sort();
  return { kind: 'ok', options };
}

export function formatResult(result) {
  if (result.usageError) return `${result.usageError}\n\n${result.usage}`;
  if (result.errorMessage) return `eval scaffold failed\n\n${result.errorMessage}`;
  return ['eval scaffold passed', ...result.lines].join('\n');
}

async function initUser(repoRoot, options) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', options.userId);
  const profilePath = path.join(userRoot, 'profile.yaml');
  const seedsPath = path.join(userRoot, 'seed-preferences.generated.json');

  if (await fileExists(profilePath)) {
    throw new Error(`Refusing to overwrite existing profile ${repoRelative(repoRoot, profilePath)}.`);
  }
  if (await fileExists(seedsPath)) {
    throw new Error(
      `Refusing to overwrite existing generated seeds ${repoRelative(repoRoot, seedsPath)}.`,
    );
  }

  const fieldMaps = await loadFieldMaps(evalRoot, options.formIds);
  const facts = {};
  for (const fieldMap of fieldMaps.values()) {
    for (const field of fieldMap.fields ?? []) {
      if (field.mode !== 'fact') continue;
      setNestedValue(facts, field.factKey, null);
    }
  }

  const profile = {
    schemaVersion: 1,
    userId: options.userId,
    displayName: options.displayName,
    facts,
    seedPreferences: [],
  };

  await mkdir(userRoot, { recursive: true });
  await writeFile(profilePath, stringifyYaml(profile, { indent: 2 }));
  await writeFile(seedsPath, jsonText([]));

  return [
    `wrote ${repoRelative(repoRoot, profilePath)}`,
    `wrote ${repoRelative(repoRoot, seedsPath)}`,
  ];
}

async function renderCorpus(repoRoot, options) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', options.userId);
  const corpusRoot = path.join(userRoot, 'corpora', options.corpusId);
  const scenarioRoot = options.scenarioId
    ? path.join(evalRoot, 'scenarios', options.scenarioId)
    : null;

  if (!options.force && (await fileExists(corpusRoot))) {
    throw new Error(`Corpus already exists: ${repoRelative(repoRoot, corpusRoot)}. Use --force to overwrite.`);
  }
  if (scenarioRoot && (await fileExists(scenarioRoot))) {
    throw new Error(`Scenario already exists: ${repoRelative(repoRoot, scenarioRoot)}. Existing scenarios are runner-owned and cannot be overwritten by scaffold.`);
  }

  const profilePath = path.join(userRoot, 'profile.yaml');
  const profile = parseYaml(await readFile(profilePath, 'utf8'));
  const profileFacts = collectFactKeys(profile.facts ?? {});
  const seed = options.seed ?? `${options.userId}__${options.corpusId}`;
  const fieldMaps = await loadFieldMaps(evalRoot, options.formIds);
  const templates = await discoverTemplates({ evalRoot });
  const selection = selectTemplates({
    templates,
    profile,
    profileFacts,
    fieldMaps,
    seed,
    count: options.count,
  });

  if (selection.selected.length === 0) {
    throw new Error('No templates selected. Fill profile.yaml with non-null form facts before rendering.');
  }

  const intentionallyMissing = buildIntentionallyMissing({
    missingFactKeys: options.missingFactKeys,
    fieldMaps,
    profileFacts,
  });

  const renderedDocuments = selection.selected.map((template, index) => {
    const meta = template.meta;
    const number = String(index + 1).padStart(3, '0');
    const templateSlug = meta.templateId.split('/').at(-1);
    const documentPath = `documents/${meta.category}/${number}-${templateSlug}.${meta.outputExtension}`;
    const rendered = renderTemplate({ template, profileFacts, seed });

    return {
      content: rendered.content,
      document: {
        id: number,
        path: documentPath,
        category: meta.category,
        title: meta.title,
        outputExtension: meta.outputExtension,
        factContract: {
          include: rendered.factKeys,
          forbid: [],
        },
        evaluationRole: {
          detailTier: meta.detailTier,
          authority: meta.authority,
          freshness: meta.freshness,
          expectedUse: meta.expectedUse,
          challengeTags: [],
        },
        template: meta.templateId,
      },
    };
  });
  const documents = renderedDocuments.map((rendered) => rendered.document);

  if (options.force) {
    await rm(corpusRoot, { recursive: true, force: true });
  }

  for (const rendered of renderedDocuments) {
    const absolutePath = path.join(corpusRoot, rendered.document.path);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, rendered.content);
  }

  const manifest = {
    schemaVersion: 2,
    userId: options.userId,
    corpusId: options.corpusId,
    seed,
    corpusKind: 'template-smoke',
    forms: options.formIds,
    purpose: `Generated template-scaffold corpus for ${options.formIds.join(', ')} form-fill evaluation.`,
    intentionallyMissing,
    documents,
  };

  await mkdir(corpusRoot, { recursive: true });
  const manifestPath = path.join(corpusRoot, 'manifest.json');
  await writeFile(manifestPath, jsonText(manifest));

  const seedRows = deriveSeedPreferences(profile);
  const seedsPath = path.join(userRoot, 'seed-preferences.generated.json');
  await writeFile(seedsPath, jsonText(seedRows));

  const lines = [
    `wrote ${repoRelative(repoRoot, manifestPath)}`,
    `wrote ${repoRelative(repoRoot, seedsPath)}`,
  ];

  if (scenarioRoot) {
    const scenario = {
      schemaVersion: 1,
      scenarioId: options.scenarioId,
      description: `Generated template-scaffold scenario for ${profile.displayName} using ${options.formIds[0]}.`,
      userId: options.userId,
      corpusId: options.corpusId,
      formId: options.formIds[0],
      expectedSnapshots: [],
    };
    const scenarioPath = path.join(scenarioRoot, 'scenario.json');
    const promptPath = path.join(scenarioRoot, 'start', 'prompt.md');
    const prompt =
      `Fill ${options.formIds[0]} for ${profile.displayName} using the seeded memory and corpus documents. Leave fields blank when the available facts do not support a value.\n`;
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(scenarioPath, jsonText(scenario));
    await writeFile(promptPath, prompt);
    lines.push(`wrote ${repoRelative(repoRoot, scenarioPath)}`);
    lines.push(`wrote ${repoRelative(repoRoot, promptPath)}`);
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
  lines.push(formatValidationResult(validation));
  if (validation.exitCode !== 0) {
    throw new Error(formatValidationResult(validation));
  }

  if (scenarioRoot) {
    const scenarioValidation = await runValidation({
      repoRoot,
      args: ['--scenario', options.scenarioId],
    });
    lines.push(formatValidationResult(scenarioValidation));
    if (scenarioValidation.exitCode !== 0) {
      throw new Error(formatValidationResult(scenarioValidation));
    }
  }

  return lines;
}

function selectTemplates({ templates, profile, profileFacts, fieldMaps, seed, count }) {
  const seedCovered = new Set();
  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts, entry.factKey);
    if (value != null) seedCovered.add(entry.factKey);
  }

  const requiredFacts = new Set();
  for (const fieldMap of fieldMaps.values()) {
    for (const field of fieldMap.fields ?? []) {
      if (field.mode !== 'fact') continue;
      const factState = classifyFactKey(profileFacts, field.factKey);
      if (factState.kind === 'leaf' && factState.value != null) {
        requiredFacts.add(field.factKey);
      }
    }
  }
  for (const factKey of seedCovered) requiredFacts.delete(factKey);

  const eligibleTemplates = templates
    .filter((template) =>
      (template.meta.requiredFactKeys ?? []).every((factKey) => {
        const factState = classifyFactKey(profileFacts, factKey);
        return factState.kind === 'leaf' && factState.value != null;
      }),
    )
    .sort((left, right) => compareTemplates(left, right, seed));

  const selected = [];
  const selectedIds = new Set();
  const uncovered = new Set(requiredFacts);

  while (uncovered.size > 0) {
    const candidates = eligibleTemplates
      .filter((template) => !selectedIds.has(template.meta.templateId))
      .map((template) => ({
        template,
        coverage: (template.meta.requiredFactKeys ?? []).filter((factKey) =>
          uncovered.has(factKey),
        ).length,
      }))
      .filter((candidate) => candidate.coverage > 0)
      .sort((left, right) =>
        right.coverage - left.coverage ||
        compareTemplates(left.template, right.template, seed),
      );

    const next = candidates[0]?.template;
    if (!next) {
      throw new Error(
        `No eligible template covers required facts: ${[...uncovered].sort().join(', ')}`,
      );
    }

    selected.push(next);
    selectedIds.add(next.meta.templateId);
    for (const factKey of next.meta.requiredFactKeys ?? []) {
      uncovered.delete(factKey);
    }
  }

  if (count == null) return { selected, eligibleTemplates };
  if (count < selected.length) {
    throw new Error(`--count ${count} is smaller than required template count ${selected.length}.`);
  }
  if (count > eligibleTemplates.length) {
    throw new Error(`--count ${count} exceeds eligible template count ${eligibleTemplates.length}.`);
  }

  for (const template of eligibleTemplates) {
    if (selected.length >= count) break;
    if (selectedIds.has(template.meta.templateId)) continue;
    selected.push(template);
    selectedIds.add(template.meta.templateId);
  }

  return { selected, eligibleTemplates };
}

function compareTemplates(left, right, seed) {
  return (
    left.meta.defaultOrder - right.meta.defaultOrder ||
    hashInt(seed, left.meta.templateId) - hashInt(seed, right.meta.templateId) ||
    (left.meta.templateId < right.meta.templateId
      ? -1
      : left.meta.templateId > right.meta.templateId
        ? 1
        : 0)
  );
}

function buildIntentionallyMissing({ missingFactKeys, fieldMaps, profileFacts }) {
  return missingFactKeys.map((factKey) => {
    const factState = classifyFactKey(profileFacts, factKey);
    if (factState.kind !== 'leaf') {
      throw new Error(`--missing ${factKey} must resolve to a profile leaf.`);
    }
    if (factState.value !== null) {
      throw new Error(`--missing ${factKey} must be null in profile.yaml.`);
    }

    const forms = [...fieldMaps.entries()]
      .filter(([, fieldMap]) =>
        (fieldMap.fields ?? []).some(
          (field) => field.mode === 'fact' && field.factKey === factKey,
        ),
      )
      .map(([formId]) => formId)
      .sort();

    if (forms.length === 0) {
      throw new Error(`--missing ${factKey} is not referenced by selected forms.`);
    }

    return {
      factKey,
      forms,
      reason: MISSING_REASON,
      expectedBehavior: MISSING_EXPECTED_BEHAVIOR,
    };
  });
}

async function loadFieldMaps(evalRoot, formIds) {
  const maps = new Map();
  for (const formId of formIds) {
    const fieldMapPath = path.join(evalRoot, 'forms', formId, 'field-map.json');
    const fieldMap = JSON.parse(await readFile(fieldMapPath, 'utf8'));
    maps.set(formId, fieldMap);
  }
  return maps;
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
    '  pnpm eval:scaffold --user <userId> --corpus <corpusId> --form <formId> [--form <formId>] [--count <n>] [--seed <seed>] [--missing <factKey>] [--scenario <scenarioId>] [--force]',
    '  pnpm eval:scaffold --init-user --user <userId> --display-name "<Name>" --form <formId>',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runScaffold({ args: process.argv.slice(2) });
  console.log(formatResult(result));
  process.exitCode = result.exitCode;
}
