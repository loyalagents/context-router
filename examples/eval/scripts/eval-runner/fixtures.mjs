import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { collectFactKeys, getFactValue } from '../shared.mjs';

export async function loadScenarioFixture({ repoRoot, scenarioId }) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const scenarioRoot = path.join(evalRoot, 'scenarios', scenarioId);
  const scenario = await readJson(path.join(scenarioRoot, 'scenario.json'));
  const userRoot = path.join(evalRoot, 'users', scenario.userId);
  const corpusRoot = path.join(userRoot, 'corpora', scenario.corpusId);
  const formRoot = path.join(evalRoot, 'forms', scenario.formId);

  const profile = await readYaml(path.join(userRoot, 'profile.yaml'));
  const [seedPreferences, manifest, fieldMap, fieldsGenerated, prompt] =
    await Promise.all([
      readSeedPreferences({ userRoot, profile }),
      readJson(path.join(corpusRoot, 'manifest.json')),
      readJson(path.join(formRoot, 'field-map.json')),
      readJson(path.join(formRoot, 'fields.generated.json')),
      readFile(path.join(scenarioRoot, 'start/prompt.md'), 'utf8'),
    ]);

  const joinedFields = joinFixtureFields(fieldMap, fieldsGenerated);

  return {
    repoRoot,
    evalRoot,
    scenarioRoot,
    userRoot,
    corpusRoot,
    formRoot,
    formPdfPath: path.join(formRoot, 'form.pdf'),
    scenario,
    profile,
    seedPreferences,
    manifest,
    fieldMap,
    fieldsGenerated,
    joinedFields,
    prompt,
    profileFacts: collectFactKeys(profile.facts ?? {}),
  };
}

export function seedSlugByFactKey(profile) {
  const byFactKey = new Map();
  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts ?? {}, entry.factKey);
    if (value == null) continue;
    byFactKey.set(entry.factKey, entry.slug);
  }
  return byFactKey;
}

export function optionValuesForField(generatedField, fieldsGenerated) {
  if (!generatedField?.optionSetId) return [];
  const optionSet = (fieldsGenerated.optionSets ?? []).find(
    (candidate) => candidate.id === generatedField.optionSetId,
  );
  return optionSet?.options ?? [];
}

function joinFixtureFields(fieldMap, fieldsGenerated) {
  const generatedByIndex = new Map(
    (fieldsGenerated.fields ?? []).map((field) => [field.index, field]),
  );

  return (fieldMap.fields ?? [])
    .map((field) => {
      const generated = generatedByIndex.get(field.fieldIndex);
      if (!generated) {
        throw new Error(
          `Field map index ${field.fieldIndex} has no generated field metadata.`,
        );
      }
      if (generated.pdfFieldName !== field.pdfFieldName) {
        throw new Error(
          `Field map index ${field.fieldIndex} names ${JSON.stringify(
            field.pdfFieldName,
          )}, but generated metadata names ${JSON.stringify(generated.pdfFieldName)}.`,
        );
      }
      return { fieldMap: field, generated };
    })
    .sort((left, right) => left.fieldMap.fieldIndex - right.fieldMap.fieldIndex);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readSeedPreferences({ userRoot, profile }) {
  if (profile.seedPreferences === undefined) return [];
  if (!Array.isArray(profile.seedPreferences)) {
    throw new Error('profile.seedPreferences must be an array when present.');
  }

  const generatedPath = path.join(userRoot, 'seed-preferences.generated.json');
  try {
    return await readJson(generatedPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Profile declares seedPreferences[], but generated seed preferences are missing at ${generatedPath}. Run pnpm eval:derive-seeds.`,
      );
    }
    throw error;
  }
}

async function readYaml(filePath) {
  return parseYaml(await readFile(filePath, 'utf8'));
}
