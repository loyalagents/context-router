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
  const startedAt = isoTimestamp(now);
  let stage = 'validate-input';
  let backendUser = null;
  let reset = null;
  let definitionTargets = [];
  const definitionSetup = {
    created: [],
    existing: [],
  };
  const accepted = [];
  const skipped = [];
  const duplicateSlugs = new Set();
  let currentDefinition = null;
  let currentPreference = null;

  try {
    if (!memorySnapshot || typeof memorySnapshot !== 'object') {
      throw new Error('memorySnapshot is required for materialization.');
    }
    if (!graphqlUrl) {
      throw new Error('graphqlUrl is required for materialization.');
    }
    if (!authToken) {
      throw new Error('authToken is required for materialization.');
    }

    stage = 'fetch-backend-user';
    backendUser = await fetchBackendUser({
      graphqlUrl,
      authToken,
      fetchImpl,
    });

    stage = 'reset-memory';
    reset = resetMemoryEnabled
      ? await resetMemory({
          graphqlUrl,
          authToken,
          mode: resetMemoryMode,
          fetchImpl,
        })
      : null;

    stage = 'fetch-preference-schema';
    const existingSchema = await fetchPreferenceSchema({
      graphqlUrl,
      authToken,
      fetchImpl,
    });
    const existing = existingDefinitionMap(existingSchema);

    stage = 'build-definition-targets';
    definitionTargets = definitionTargetsFromSnapshot(memorySnapshot);

    for (const target of definitionTargets) {
      stage = 'setup-definition';
      currentDefinition = { slug: target.slug };
      const existingDefinition = existing.get(target.slug);
      if (existingDefinition) {
        assertCompatibleDefinition({
          target,
          existingDefinition,
          resetMemoryMode,
        });
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

    currentDefinition = null;
    const preferences = Array.isArray(memorySnapshot.preferences)
      ? memorySnapshot.preferences
      : [];
    const seenSlugs = new Set();

    for (const [index, preference] of preferences.entries()) {
      const slug = requiredString(preference.slug, `preferences[${index}].slug`);
      currentPreference = {
        index,
        slug,
        syntheticPreferenceId: preference.id ?? null,
      };
      if (seenSlugs.has(slug)) duplicateSlugs.add(slug);
      seenSlugs.add(slug);

      stage = 'suggest-preference';
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

      stage = 'accept-suggested-preference';
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
    currentPreference = null;

    const report = buildMaterializationReport({
      status: 'pass',
      repoRoot,
      memorySnapshot,
      memorySnapshotPath,
      graphqlUrl,
      resetMemoryEnabled,
      resetMemoryMode,
      backendUser,
      startedAt,
      endedAt: isoTimestamp(now),
      reset,
      definitionTargets,
      definitionSetup,
      accepted,
      skipped,
      duplicateSlugs,
    });

    if (reportOutPath) {
      await writeJson(reportOutPath, report);
    }
    return {
      backendUserId: backendUser.userId,
      report,
      summary: report.summary,
    };
  } catch (error) {
    const report = buildMaterializationReport({
      status: 'fail',
      repoRoot,
      memorySnapshot,
      memorySnapshotPath,
      graphqlUrl,
      resetMemoryEnabled,
      resetMemoryMode,
      backendUser,
      startedAt,
      endedAt: isoTimestamp(now),
      reset,
      definitionTargets,
      definitionSetup,
      accepted,
      skipped,
      duplicateSlugs,
      failure: {
        stage,
        currentDefinition,
        currentPreference,
        error: sanitizeError(error),
        details: error?.details ?? null,
      },
    });
    if (reportOutPath) {
      await writeJson(reportOutPath, report).catch(() => {});
    }
    throw error;
  }
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
      scope: 'GLOBAL',
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
      scope: 'GLOBAL',
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
    scope: target.scope,
    ...(target.valueType === 'ENUM' ? { options: target.options } : {}),
    isSensitive: target.isSensitive,
    isCore: false,
  };
}

function assertCompatibleDefinition({ target, existingDefinition, resetMemoryMode }) {
  const actualValueType = String(existingDefinition.valueType ?? '').toUpperCase();
  const actualScope = String(existingDefinition.scope ?? '').toUpperCase();
  const existingOptions = target.valueType === 'ENUM'
    ? normalizedStringArray(existingDefinition.options)
    : null;
  const requiredOptions = target.valueType === 'ENUM'
    ? normalizedStringArray(target.options)
    : null;
  const missingOptions = target.valueType === 'ENUM'
    ? requiredOptions.filter((option) => !existingOptions.includes(option))
    : [];
  const mismatches = [];

  if (actualValueType !== target.valueType) {
    mismatches.push({
      field: 'valueType',
      existing: actualValueType || null,
      required: target.valueType,
    });
  }
  if (actualScope !== target.scope) {
    mismatches.push({
      field: 'scope',
      existing: actualScope || null,
      required: target.scope,
    });
  }
  if (missingOptions.length > 0) {
    mismatches.push({
      field: 'options',
      existing: existingOptions,
      required: requiredOptions,
      missing: missingOptions,
    });
  }

  if (mismatches.length > 0) {
    const error = new Error(
      `Existing definition ${target.slug} is incompatible with synthetic snapshot requirements.`,
    );
    error.name = 'MaterializationCompatibilityError';
    error.details = {
      slug: target.slug,
      definitionId: existingDefinition?.id ?? null,
      ownerUserId: existingDefinition?.ownerUserId ?? null,
      resetMode: resetMemoryMode ?? null,
      suggestedResetMode: 'DEMO_DATA',
      existing: {
        valueType: actualValueType || null,
        scope: actualScope || null,
        options: existingOptions,
      },
      required: {
        valueType: target.valueType,
        scope: target.scope,
        options: requiredOptions,
      },
      mismatches,
    };
    throw error;
  }
}

function definitionSummary(target, definition) {
  return {
    slug: target.slug,
    valueType: target.valueType,
    scope: target.scope,
    definitionId: definition?.id ?? null,
    ownerUserId: definition?.ownerUserId ?? null,
    requiredOptions: target.valueType === 'ENUM' ? normalizedStringArray(target.options) : null,
    existingOptions: target.valueType === 'ENUM'
      ? normalizedStringArray(definition?.options)
      : null,
  };
}

function buildMaterializationReport({
  status,
  repoRoot,
  memorySnapshot,
  memorySnapshotPath,
  graphqlUrl,
  resetMemoryEnabled,
  resetMemoryMode,
  backendUser,
  startedAt,
  endedAt,
  reset,
  definitionTargets,
  definitionSetup,
  accepted,
  skipped,
  duplicateSlugs,
  failure = null,
}) {
  const preferences = Array.isArray(memorySnapshot?.preferences)
    ? memorySnapshot.preferences
    : [];
  return {
    schemaVersion: 1,
    artifactType: 'synthetic-memory-materialization-report',
    status,
    runId: memorySnapshot?.runId ?? null,
    userId: memorySnapshot?.userId ?? null,
    corpusId: memorySnapshot?.corpusId ?? null,
    backendUserId: backendUser?.userId ?? null,
    startedAt,
    endedAt,
    settings: {
      graphqlUrl: graphqlUrl ? sanitizeGraphqlUrl(graphqlUrl) : null,
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
    ...(failure ? { failure } : {}),
  };
}

function sanitizeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: String(error?.message ?? error),
  };
}

function normalizedStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((option) => typeof option === 'string' && option.length > 0))]
    .sort();
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
