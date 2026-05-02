#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(scriptDir, '..');
const errors = [];

function displayPath(filePath) {
  return relative(demoRoot, filePath);
}

function addError(message) {
  errors.push(message);
}

function requireFile(filePath, label) {
  if (!existsSync(filePath)) {
    addError(`${label} is missing: ${displayPath(filePath)}`);
    return false;
  }

  return true;
}

async function readText(filePath, label) {
  if (!requireFile(filePath, label)) {
    return null;
  }

  return readFile(filePath, 'utf8');
}

async function readJson(filePath, label) {
  const text = await readText(filePath, label);
  if (text === null) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    addError(`${label} is invalid JSON: ${displayPath(filePath)} (${error.message})`);
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateAllowedKeys(object, allowedKeys, label) {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      addError(`${label} has unsupported key "${key}"`);
    }
  }
}

function validatePreferenceArray(value, label) {
  if (!Array.isArray(value)) {
    addError(`${label} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      addError(`${label}[${index}] must be an object`);
      return;
    }

    if (!isNonEmptyString(entry.slug)) {
      addError(`${label}[${index}].slug must be a non-empty string`);
    }

    if (!Object.prototype.hasOwnProperty.call(entry, 'value')) {
      addError(`${label}[${index}].value is required`);
    }
  });
}

function extractHtmlIds(html) {
  const ids = new Set();
  const idPattern = /\bid\s*=\s*(["'])(.*?)\1/g;
  let match;

  while ((match = idPattern.exec(html)) !== null) {
    ids.add(match[2]);
  }

  return ids;
}

function compareKeySets(actualKeys, expectedKeys, label) {
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);

  for (const key of expected) {
    if (!actual.has(key)) {
      addError(`${label} is missing key "${key}"`);
    }
  }

  for (const key of actual) {
    if (!expected.has(key)) {
      addError(`${label} has unexpected key "${key}"`);
    }
  }
}

async function listScenarioIds() {
  const scenariosDir = join(demoRoot, 'scenarios');
  if (!requireFile(scenariosDir, 'scenarios directory')) {
    return [];
  }

  const entries = await readdir(scenariosDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((scenarioId) =>
      existsSync(join(scenariosDir, scenarioId, 'start', 'scenario.json')),
    )
    .sort();
}

async function validateScenario(scenarioId) {
  const scenarioDir = join(demoRoot, 'scenarios', scenarioId);
  const scenarioPath = join(scenarioDir, 'start', 'scenario.json');
  const scenario = await readJson(
    scenarioPath,
    `scenario "${scenarioId}" manifest`,
  );

  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    addError(`scenario "${scenarioId}" manifest must be a JSON object`);
    return;
  }

  validateAllowedKeys(
    scenario,
    new Set(['$schema', 'description', 'formId', 'userId', 'userVariant']),
    `scenario "${scenarioId}" manifest`,
  );

  for (const field of ['description', 'formId', 'userId', 'userVariant']) {
    if (!isNonEmptyString(scenario[field])) {
      addError(`scenario "${scenarioId}" requires non-empty "${field}"`);
    }
  }

  if (
    !isNonEmptyString(scenario.formId) ||
    !isNonEmptyString(scenario.userId) ||
    !isNonEmptyString(scenario.userVariant)
  ) {
    return;
  }

  const formDir = join(demoRoot, 'forms', scenario.formId);
  const formHtmlPath = join(formDir, 'form.html');
  const fieldsPath = join(formDir, 'fields.json');
  const profilePath = join(demoRoot, 'users', scenario.userId, 'profile.json');
  const variantDir = join(demoRoot, 'users', scenario.userId, scenario.userVariant);
  const seedPreferencesPath = join(variantDir, 'seed-preferences.json');
  const localMemoryPath = join(variantDir, 'local-memory.md');
  const promptPath = join(scenarioDir, 'start', 'prompt.md');
  const filledFormPath = join(scenarioDir, 'expected', 'filled-form.json');
  const writtenPreferencesPath = join(
    scenarioDir,
    'expected',
    'written-preferences.json',
  );
  const finalPreferencesPath = join(
    scenarioDir,
    'expected',
    'final-preferences.json',
  );

  const html = await readText(formHtmlPath, `scenario "${scenarioId}" form HTML`);
  const fieldsManifest = await readJson(
    fieldsPath,
    `scenario "${scenarioId}" fields manifest`,
  );
  const profile = await readJson(profilePath, `scenario "${scenarioId}" profile`);
  const seedPreferences = await readJson(
    seedPreferencesPath,
    `scenario "${scenarioId}" seed preferences`,
  );
  await readText(localMemoryPath, `scenario "${scenarioId}" local memory`);
  await readText(promptPath, `scenario "${scenarioId}" prompt`);
  const filledForm = await readJson(
    filledFormPath,
    `scenario "${scenarioId}" filled form expected output`,
  );
  const writtenPreferences = await readJson(
    writtenPreferencesPath,
    `scenario "${scenarioId}" written preferences expected output`,
  );
  const finalPreferences = await readJson(
    finalPreferencesPath,
    `scenario "${scenarioId}" final preferences expected output`,
  );

  validatePreferenceArray(
    seedPreferences,
    `scenario "${scenarioId}" seed-preferences.json`,
  );
  validatePreferenceArray(
    writtenPreferences,
    `scenario "${scenarioId}" written-preferences.json`,
  );
  validatePreferenceArray(
    finalPreferences,
    `scenario "${scenarioId}" final-preferences.json`,
  );

  if (fieldsManifest === null) {
    return;
  }

  if (
    typeof fieldsManifest !== 'object' ||
    Array.isArray(fieldsManifest)
  ) {
    addError(`scenario "${scenarioId}" fields manifest must be a JSON object`);
    return;
  }

  if (!Array.isArray(fieldsManifest.fields)) {
    addError(`scenario "${scenarioId}" fields manifest requires a fields array`);
    return;
  }

  const fieldIds = [];
  const seenFieldIds = new Set();

  for (const [index, field] of fieldsManifest.fields.entries()) {
    const fieldLabel = `scenario "${scenarioId}" fields[${index}]`;
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      addError(`${fieldLabel} must be an object`);
      continue;
    }

    if (!isNonEmptyString(field.id)) {
      addError(`${fieldLabel}.id must be a non-empty string`);
      continue;
    }

    if (seenFieldIds.has(field.id)) {
      addError(`scenario "${scenarioId}" has duplicate field id "${field.id}"`);
    }
    seenFieldIds.add(field.id);
    fieldIds.push(field.id);

    if (field.source === 'profile') {
      if (!isNonEmptyString(field.profilePath)) {
        addError(`${fieldLabel} with source "profile" requires profilePath`);
      } else if (
        profile &&
        typeof profile === 'object' &&
        !Array.isArray(profile) &&
        !Object.prototype.hasOwnProperty.call(profile, field.profilePath)
      ) {
        addError(
          `${fieldLabel} references missing profile key "${field.profilePath}"`,
        );
      }
    } else if (field.source === 'mcp-memory') {
      if (
        !Array.isArray(field.memorySlugs) ||
        field.memorySlugs.length === 0 ||
        field.memorySlugs.some((slug) => !isNonEmptyString(slug))
      ) {
        addError(
          `${fieldLabel} with source "mcp-memory" requires non-empty memorySlugs`,
        );
      }
    } else if (field.source !== 'freeform') {
      addError(`${fieldLabel}.source must be profile, mcp-memory, or freeform`);
    }
  }

  if (html !== null) {
    const htmlIds = extractHtmlIds(html);
    for (const fieldId of fieldIds) {
      if (!htmlIds.has(fieldId)) {
        addError(
          `scenario "${scenarioId}" field "${fieldId}" is missing from form HTML ids`,
        );
      }
    }
  }

  if (filledForm && typeof filledForm === 'object' && !Array.isArray(filledForm)) {
    compareKeySets(
      Object.keys(filledForm),
      fieldIds,
      `scenario "${scenarioId}" filled-form.json`,
    );
  } else if (filledForm !== null) {
    addError(`scenario "${scenarioId}" filled-form.json must be a JSON object`);
  }
}

const scenarioIds = await listScenarioIds();

if (scenarioIds.length === 0) {
  addError('No scenarios found under scenarios/*/start/scenario.json');
}

for (const scenarioId of scenarioIds) {
  await validateScenario(scenarioId);
}

if (errors.length > 0) {
  console.error(`Memory demo verification failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Memory demo verification passed for ${scenarioIds.length} scenario(s).`);
