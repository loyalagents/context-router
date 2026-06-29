import {
  acceptSuggestedPreference,
  createPreferenceDefinition,
  fetchBackendUser,
  fetchPreferenceSchema,
  resetMemory,
  suggestPreference,
} from './ingestor/client.mjs';
import { existingDefinitionMap } from './ingestor/definitions.mjs';
import { sanitizeGraphqlUrl } from './memory-snapshot/sanitize.mjs';
import {
  relativePath,
  writeJson,
} from './scoring/io.mjs';

const VALUE_TYPES = new Set(['ARRAY', 'BOOLEAN', 'ENUM', 'STRING']);

export async function materializeSyntheticMemorySnapshot({
  repoRoot,
  memorySnapshot,
  memorySnapshotPath,
  reportOutPath,
  graphqlUrl,
  authToken,
  resetMemoryEnabled = false,
  resetMemoryMode = 'MEMORY_ONLY',
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  if (!memorySnapshot || typeof memorySnapshot !== 'object') {
    throw new Error('memorySnapshot is required for materialization.');
  }
  if (!graphqlUrl) {
    throw new Error('graphqlUrl is required for materialization.');
  }
  if (!authToken) {
    throw new Error('authToken is required for materialization.');
  }

  const startedAt = isoTimestamp(now);
  const backendUser = await fetchBackendUser({
    graphqlUrl,
    authToken,
    fetchImpl,
  });
  const reset = resetMemoryEnabled
    ? await resetMemory({
        graphqlUrl,
        authToken,
        mode: resetMemoryMode,
        fetchImpl,
      })
    : null;

  const existingSchema = await fetchPreferenceSchema({
    graphqlUrl,
    authToken,
    fetchImpl,
  });
  const existing = existingDefinitionMap(existingSchema);
  const definitionTargets = definitionTargetsFromSnapshot(memorySnapshot);
  const definitionSetup = {
    created: [],
    existing: [],
  };

  for (const target of definitionTargets) {
    const existingDefinition = existing.get(target.slug);
    if (existingDefinition) {
      assertCompatibleDefinition({ target, existingDefinition });
      definitionSetup.existing.push(definitionSummary(target, existingDefinition));
      continue;
    }
    const created = await createPreferenceDefinition({
      graphqlUrl,
      authToken,
      input: definitionInput(target),
      fetchImpl,
    });
    existing.set(target.slug, created);
    definitionSetup.created.push(definitionSummary(target, created));
  }

  const preferences = Array.isArray(memorySnapshot.preferences)
    ? memorySnapshot.preferences
    : [];
  const seenSlugs = new Set();
  const duplicateSlugs = new Set();
  const accepted = [];
  const skipped = [];

  for (const [index, preference] of preferences.entries()) {
    const slug = requiredString(preference.slug, `preferences[${index}].slug`);
    if (seenSlugs.has(slug)) duplicateSlugs.add(slug);
    seenSlugs.add(slug);

    const suggestion = await suggestPreference({
      graphqlUrl,
      authToken,
      input: suggestionInput({
        preference,
        runId: memorySnapshot.runId,
        memorySnapshotPath: memorySnapshotPath
          ? relativePath(repoRoot, memorySnapshotPath)
          : null,
      }),
      fetchImpl,
    });
    if (!suggestion) {
      skipped.push({
        slug,
        reason: 'suggestPreference returned null',
        syntheticPreferenceId: preference.id ?? null,
      });
      continue;
    }

    const active = await acceptSuggestedPreference({
      graphqlUrl,
      authToken,
      id: suggestion.id,
      fetchImpl,
    });
    accepted.push({
      slug,
      suggestionId: suggestion.id,
      activePreferenceId: active?.id ?? null,
      syntheticPreferenceId: preference.id ?? null,
      duplicateSlug: duplicateSlugs.has(slug),
    });
  }

  const endedAt = isoTimestamp(now);
  const report = {
    schemaVersion: 1,
    artifactType: 'synthetic-memory-materialization-report',
    status: 'pass',
    runId: memorySnapshot.runId ?? null,
    userId: memorySnapshot.userId ?? null,
    corpusId: memorySnapshot.corpusId ?? null,
    backendUserId: backendUser.userId,
    startedAt,
    endedAt,
    settings: {
      graphqlUrl: sanitizeGraphqlUrl(graphqlUrl),
      resetMemory: Boolean(resetMemoryEnabled),
      resetMode: resetMemoryEnabled ? resetMemoryMode : null,
      inputMemorySnapshot: memorySnapshotPath
        ? relativePath(repoRoot, memorySnapshotPath)
        : null,
    },
    reset,
    definitionSetup,
    preferenceMaterialization: {
      accepted,
      skipped,
      duplicateSlugs: [...duplicateSlugs].sort(),
    },
    summary: {
      definitionTargetCount: definitionTargets.length,
      createdDefinitionCount: definitionSetup.created.length,
      existingDefinitionCount: definitionSetup.existing.length,
      preferenceInputCount: preferences.length,
      acceptedPreferenceCount: accepted.length,
      skippedSuggestionCount: skipped.length,
      duplicateSlugCount: duplicateSlugs.size,
    },
  };

  if (reportOutPath) {
    await writeJson(reportOutPath, report);
  }
  return {
    backendUserId: backendUser.userId,
    report,
    summary: report.summary,
  };
}

export function definitionTargetsFromSnapshot(memorySnapshot) {
  const valuesBySlug = new Map();
  for (const [index, preference] of (memorySnapshot.preferences ?? []).entries()) {
    const slug = requiredString(preference.slug, `preferences[${index}].slug`);
    if (!valuesBySlug.has(slug)) valuesBySlug.set(slug, []);
    valuesBySlug.get(slug).push(preference.value);
  }

  const bySlug = new Map();
  for (const [index, definition] of (memorySnapshot.definitions ?? []).entries()) {
    const slug = requiredString(definition.slug, `definitions[${index}].slug`);
    const valueType = normalizedValueType(
      definition.valueType,
      `definitions[${index}].valueType`,
    );
    const existing = bySlug.get(slug);
    if (existing && existing.valueType !== valueType) {
      throw new Error(
        `Synthetic definition ${slug} has conflicting value types: ${existing.valueType} and ${valueType}.`,
      );
    }
    const target = existing ?? {
      slug,
      displayName: definition.displayName ?? null,
      description: definition.description || `Direct open-schema eval definition for ${slug}.`,
      valueType,
      isSensitive: Boolean(definition.isSensitive),
      options: [],
    };
    target.isSensitive = target.isSensitive || Boolean(definition.isSensitive);
    if (valueType === 'ENUM') {
      for (const option of enumOptions(definition.options, valuesBySlug.get(slug) ?? [])) {
        if (!target.options.includes(option)) target.options.push(option);
      }
    }
    bySlug.set(slug, target);
  }

  for (const [slug, values] of valuesBySlug.entries()) {
    if (bySlug.has(slug)) continue;
    const valueType = valueTypeForValues(slug, values);
    bySlug.set(slug, {
      slug,
      displayName: null,
      description: `Direct open-schema eval definition for ${slug}.`,
      valueType,
      isSensitive: false,
      options: valueType === 'ENUM' ? enumOptions(null, values) : [],
    });
  }

  return [...bySlug.values()]
    .map((target) => ({
      ...target,
      options: target.valueType === 'ENUM' ? [...new Set(target.options)].sort() : null,
    }))
    .sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0));
}

function suggestionInput({ preference, runId, memorySnapshotPath }) {
  const slug = requiredString(preference.slug, 'preference.slug');
  return {
    slug,
    value: preference.value,
    ...(preference.locationId ? { locationId: preference.locationId } : {}),
    confidence: confidenceValue(preference.confidence),
    evidence: {
      source: 'direct-open-schema-materializer',
      runId: runId ?? null,
      memorySnapshot: memorySnapshotPath,
      syntheticPreferenceId: preference.id ?? null,
      syntheticDefinitionId: preference.definitionId ?? null,
      extractionEvidence: preference.evidence ?? null,
    },
  };
}

function definitionInput(target) {
  return {
    slug: target.slug,
    displayName: target.displayName || displayNameForSlug(target.slug),
    description: target.description || `Direct open-schema eval definition for ${target.slug}.`,
    valueType: target.valueType,
    scope: 'GLOBAL',
    ...(target.valueType === 'ENUM' ? { options: target.options } : {}),
    isSensitive: target.isSensitive,
    isCore: false,
  };
}

function assertCompatibleDefinition({ target, existingDefinition }) {
  const actualValueType = String(existingDefinition.valueType ?? '').toUpperCase();
  if (actualValueType !== target.valueType) {
    throw new Error(
      `Existing definition ${target.slug} has valueType ${actualValueType || '<missing>'}, expected ${target.valueType}.`,
    );
  }
}

function definitionSummary(target, definition) {
  return {
    slug: target.slug,
    valueType: target.valueType,
    definitionId: definition?.id ?? null,
    ownerUserId: definition?.ownerUserId ?? null,
  };
}

function enumOptions(definitionOptions, values) {
  const options = [];
  if (Array.isArray(definitionOptions)) {
    for (const option of definitionOptions) {
      if (typeof option === 'string' && option.length > 0) options.push(option);
    }
  }
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) options.push(value);
  }
  return options;
}

function valueTypeForValues(slug, values) {
  const types = new Set(values.map((value) => {
    if (Array.isArray(value)) return 'ARRAY';
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (typeof value === 'string') return 'STRING';
    return null;
  }));
  types.delete(null);
  if (types.size !== 1) {
    throw new Error(`Could not infer one backend value type for synthetic preference ${slug}.`);
  }
  return [...types][0];
}

function normalizedValueType(value, pathLabel) {
  const valueType = String(value ?? '').toUpperCase();
  if (!VALUE_TYPES.has(valueType)) {
    throw new Error(`${pathLabel} must be ARRAY, BOOLEAN, ENUM, or STRING.`);
  }
  return valueType;
}

function confidenceValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return 0.75;
}

function requiredString(value, pathLabel) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${pathLabel} must be a non-empty string.`);
  }
  return value;
}

function displayNameForSlug(slug) {
  return slug
    .split('.')
    .at(-1)
    .split('_')
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ');
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}
