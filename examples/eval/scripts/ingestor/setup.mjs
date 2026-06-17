import path from 'node:path';
import { readJson, readYaml } from '../scoring/io.mjs';
import {
  createPreferenceDefinition,
  fetchBackendUser,
  fetchPreferenceSchema,
  resetMemory,
} from './client.mjs';
import {
  buildDefinitionInput,
  collectDefinitionTargets,
  existingDefinitionMap,
  summarizeDefinitionTarget,
} from './definitions.mjs';

export async function loadKnownSchemaFixture({
  repoRoot,
  evalUserId,
  corpusId,
  documentsRoot,
}) {
  const userRoot = path.join(repoRoot, 'examples/eval/users', evalUserId);
  const corpusRoot = path.join(userRoot, 'corpora', corpusId);
  const [profile, manifest, storageMap] = await Promise.all([
    readYaml(path.join(userRoot, 'profile.yaml')),
    readJson(path.join(corpusRoot, 'manifest.json')),
    readJson(path.join(repoRoot, 'examples/eval/scoring/fact-storage-map.v1.json')),
  ]);
  return {
    profile,
    manifest,
    storageMap,
    documentsRoot: path.resolve(repoRoot, documentsRoot),
  };
}

export async function prepareKnownSchemaMemory({
  repoRoot,
  evalUserId,
  corpusId,
  documentsRoot,
  graphqlUrl,
  authToken,
  resetMemoryEnabled = false,
  resetMemoryMode = 'MEMORY_ONLY',
  ensureDefinitionsEnabled = true,
  fetchImpl,
  onProgress,
}) {
  const fixture = await loadKnownSchemaFixture({
    repoRoot,
    evalUserId,
    corpusId,
    documentsRoot,
  });
  await onProgress?.({ fixture });

  const backendUser = await fetchBackendUser({
    graphqlUrl,
    authToken,
    fetchImpl,
  });
  await onProgress?.({
    fixture,
    backendUserId: backendUser.userId,
  });

  const reset = resetMemoryEnabled
    ? await resetMemory({
        graphqlUrl,
        authToken,
        mode: resetMemoryMode,
        fetchImpl,
      })
    : null;
  await onProgress?.({
    fixture,
    backendUserId: backendUser.userId,
    reset,
  });

  const definitionTargets = collectDefinitionTargets(fixture);
  await onProgress?.({
    fixture,
    backendUserId: backendUser.userId,
    reset,
    definitionTargets,
  });
  const definitionSetup = await ensureKnownSchemaDefinitions({
    graphqlUrl,
    authToken,
    fetchImpl,
    ensureDefinitions: ensureDefinitionsEnabled,
    targets: definitionTargets,
  });
  await onProgress?.({
    fixture,
    backendUserId: backendUser.userId,
    reset,
    definitionTargets,
    definitionSetup,
  });

  return {
    fixture,
    backendUserId: backendUser.userId,
    reset,
    definitionTargets,
    definitionSetup,
  };
}

export async function ensureKnownSchemaDefinitions({
  graphqlUrl,
  authToken,
  fetchImpl,
  ensureDefinitions = true,
  targets,
}) {
  const setup = { created: [], existing: [], skipped: [] };
  if (!ensureDefinitions) {
    setup.skipped = targets.map((target) =>
      summarizeDefinitionTarget(target, { reason: 'definition setup disabled' }),
    );
    return setup;
  }

  const definitions = await fetchPreferenceSchema({
    graphqlUrl,
    authToken,
    fetchImpl,
  });
  const existing = existingDefinitionMap(definitions);

  for (const target of targets) {
    const existingDefinition = existing.get(target.slug);
    if (existingDefinition) {
      assertExistingDefinitionCompatible({ target, existingDefinition });
    }
  }

  for (const target of targets) {
    const summary = summarizeDefinitionTarget(target);
    if (existing.has(target.slug)) {
      setup.existing.push(summary);
      continue;
    }
    await createPreferenceDefinition({
      graphqlUrl,
      authToken,
      input: buildDefinitionInput(target),
      fetchImpl,
    });
    existing.set(target.slug, buildDefinitionInput(target));
    setup.created.push(summary);
  }
  return setup;
}

export function assertExistingDefinitionCompatible({ target, existingDefinition }) {
  const actualValueType = String(existingDefinition.valueType ?? '').toUpperCase();
  if (actualValueType !== target.valueType) {
    throw new Error(
      `Existing definition ${target.slug} has valueType ${actualValueType || '<missing>'}, expected ${target.valueType}.`,
    );
  }
}
