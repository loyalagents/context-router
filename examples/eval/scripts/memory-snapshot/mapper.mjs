import {
  normalizeRows,
  sortPreferenceRows,
} from '../exporter/mapper.mjs';

const BASELINE_STRATEGIES = new Set([
  'none',
  'fresh-user',
  'archive-eval-owned',
  'baseline-only',
]);

export function buildMemorySnapshotArtifact({
  userId,
  corpusId,
  scenarioId,
  graphqlUrl,
  locationId,
  includeSuggestions,
  producer,
  schemaMode,
  schemaResetMode,
  runId,
  responseData,
  exportedAt,
  baselineArtifact,
}) {
  const backendUserId = authenticatedBackendUserId(responseData);
  const activeRows = normalizeRows({
    rows: responseData.activePreferences,
    expectedUserId: backendUserId,
    expectedStatus: 'ACTIVE',
    label: 'activePreferences',
  });
  const suggestedRows = includeSuggestions
    ? normalizeRows({
        rows: responseData.suggestedPreferences,
        expectedUserId: backendUserId,
        expectedStatus: 'SUGGESTED',
        label: 'suggestedPreferences',
      })
    : [];
  const definitions = sortDefinitionRows(
    normalizeDefinitionRows({
      rows: responseData.exportPreferenceSchema,
      label: 'exportPreferenceSchema',
    }),
  );

  const baseline = buildDefinitionBaseline({
    baselineArtifact,
    definitions,
    schemaResetMode,
  });

  return {
    schemaVersion: 1,
    artifactType: 'memory-snapshot',
    runId,
    evaluationMode: evaluationModeFor({ producer, schemaMode }),
    userId,
    corpusId,
    ...(scenarioId ? { scenarioId } : {}),
    storageInput: {
      schemaMode,
      producer,
      statusesScored: ['ACTIVE'],
      suggestionsWereAutoApplied: false,
    },
    preferences: sortPreferenceRows(activeRows),
    ...(includeSuggestions ? { suggestions: sortPreferenceRows(suggestedRows) } : {}),
    definitions,
    definitionBaseline: baseline,
    diagnostics: {
      exportedAt,
      graphqlUrl: sanitizeUrlForArtifact(graphqlUrl),
      queryName: 'EvalMemorySnapshotExport',
      locationMode: locationId ? 'merged-location' : 'global-only',
      locationId: locationId ?? null,
      preferencesMergedWithLocation: Boolean(locationId),
      includeSuggestions,
      activePreferenceCount: activeRows.length,
      suggestedPreferenceCount: suggestedRows.length,
      definitionCount: definitions.length,
      backendUserId,
      schemaMode,
      schemaResetMode,
    },
  };
}

export function buildDefinitionBaselineArtifact({
  userId,
  corpusId,
  scenarioId,
  graphqlUrl,
  backendUserId,
  definitions,
  capturedAt,
  schemaResetMode,
}) {
  const sortedDefinitions = sortDefinitionRows(definitions);
  return {
    schemaVersion: 1,
    artifactType: 'definition-baseline',
    userId,
    corpusId,
    ...(scenarioId ? { scenarioId } : {}),
    backendUserId,
    capturedAt,
    strategy: schemaResetMode,
    definitionIds: sortedDefinitions.map((definition) => definition.id),
    slugs: sortedDefinitions.map((definition) => definition.slug),
    definitions: sortedDefinitions,
    diagnostics: {
      graphqlUrl: sanitizeUrlForArtifact(graphqlUrl),
      definitionCount: sortedDefinitions.length,
    },
  };
}

export function normalizeDefinitionRows({ rows, label }) {
  if (!Array.isArray(rows)) {
    throw new Error(`GraphQL ${label} response must be an array.`);
  }
  return rows.map((row, index) => normalizeDefinitionRow({ row, index, label }));
}

export function normalizeDefinitionRow({ row, index, label }) {
  const rowPath = `${label}[${index}]`;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`GraphQL ${rowPath} must be an object.`);
  }

  for (const key of ['id', 'namespace', 'slug', 'description', 'valueType', 'scope', 'category']) {
    if (typeof row[key] !== 'string' || row[key].length === 0) {
      throw new Error(`GraphQL ${rowPath}.${key} must be a non-empty string.`);
    }
  }
  for (const key of ['isSensitive', 'isCore']) {
    if (typeof row[key] !== 'boolean') {
      throw new Error(`GraphQL ${rowPath}.${key} must be a boolean.`);
    }
  }
  if (
    row.displayName !== null &&
    row.displayName !== undefined &&
    typeof row.displayName !== 'string'
  ) {
    throw new Error(`GraphQL ${rowPath}.displayName must be a string or null.`);
  }
  if (
    row.ownerUserId !== null &&
    row.ownerUserId !== undefined &&
    typeof row.ownerUserId !== 'string'
  ) {
    throw new Error(`GraphQL ${rowPath}.ownerUserId must be a string or null.`);
  }
  if (
    row.archivedAt !== null &&
    row.archivedAt !== undefined &&
    typeof row.archivedAt !== 'string'
  ) {
    throw new Error(`GraphQL ${rowPath}.archivedAt must be a string or null.`);
  }

  return {
    id: row.id,
    namespace: row.namespace,
    slug: row.slug,
    displayName: row.displayName ?? null,
    ownerUserId: row.ownerUserId ?? null,
    archivedAt: row.archivedAt ?? null,
    description: row.description,
    valueType: row.valueType,
    scope: row.scope,
    options: row.options ?? null,
    isSensitive: row.isSensitive,
    isCore: row.isCore,
    category: row.category,
  };
}

export function sortDefinitionRows(rows) {
  return [...rows].sort(compareDefinitionRows);
}

export function readBaselineFromArtifact({
  artifact,
  expectedUserId,
  expectedCorpusId,
  expectedScenarioId,
  expectedBackendUserId,
}) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('definition baseline artifact must be an object.');
  }
  if (artifact.artifactType !== 'definition-baseline') {
    throw new Error('definition baseline artifactType must be "definition-baseline".');
  }
  if (artifact.userId !== expectedUserId) {
    throw new Error(
      `definition baseline userId ${artifact.userId} does not match ${expectedUserId}`,
    );
  }
  if (artifact.corpusId !== expectedCorpusId) {
    throw new Error(
      `definition baseline corpusId ${artifact.corpusId} does not match ${expectedCorpusId}`,
    );
  }
  if (
    expectedScenarioId &&
    artifact.scenarioId &&
    artifact.scenarioId !== expectedScenarioId
  ) {
    throw new Error(
      `definition baseline scenarioId ${artifact.scenarioId} does not match ${expectedScenarioId}`,
    );
  }
  if (
    expectedBackendUserId &&
    artifact.backendUserId &&
    artifact.backendUserId !== expectedBackendUserId
  ) {
    throw new Error(
      `definition baseline backendUserId ${artifact.backendUserId} does not match ${expectedBackendUserId}`,
    );
  }
  if (!Array.isArray(artifact.definitionIds)) {
    throw new Error('definition baseline definitionIds must be an array.');
  }
  if (!Array.isArray(artifact.slugs)) {
    throw new Error('definition baseline slugs must be an array.');
  }
  return {
    capturedAt: typeof artifact.capturedAt === 'string' ? artifact.capturedAt : null,
    strategy: normalizeBaselineStrategy(artifact.strategy),
    definitionIds: uniqueStrings(artifact.definitionIds, 'definition baseline definitionIds'),
    slugs: uniqueStrings(artifact.slugs, 'definition baseline slugs'),
  };
}

function buildDefinitionBaseline({ baselineArtifact, definitions, schemaResetMode }) {
  const baseline = baselineArtifact
    ? {
        capturedAt: baselineArtifact.capturedAt,
        strategy: normalizeBaselineStrategy(baselineArtifact.strategy ?? schemaResetMode),
        definitionIds: baselineArtifact.definitionIds,
        slugs: baselineArtifact.slugs,
      }
    : null;

  if (!baseline) {
    return {
      capturedBeforeRun: false,
      capturedAt: null,
      strategy: schemaResetMode,
      preexistingDefinitionIds: [],
      preexistingSlugs: [],
      newDefinitionIds: [],
      newSlugs: [],
      removedDefinitionIds: [],
      removedSlugs: [],
    };
  }

  const currentIds = definitions.map((definition) => definition.id);
  const currentSlugs = definitions.map((definition) => definition.slug);
  return {
    capturedBeforeRun: true,
    capturedAt: baseline.capturedAt,
    strategy: baseline.strategy,
    preexistingDefinitionIds: baseline.definitionIds,
    preexistingSlugs: baseline.slugs,
    newDefinitionIds: difference(currentIds, baseline.definitionIds),
    newSlugs: difference(currentSlugs, baseline.slugs),
    removedDefinitionIds: difference(baseline.definitionIds, currentIds),
    removedSlugs: difference(baseline.slugs, currentSlugs),
  };
}

function authenticatedBackendUserId(responseData) {
  const actualUserId = responseData?.me?.userId;
  if (typeof actualUserId !== 'string' || actualUserId.length === 0) {
    throw new Error('GraphQL memory snapshot response did not include me.userId.');
  }
  return actualUserId;
}

function evaluationModeFor({ producer, schemaMode }) {
  if (producer === 'mcp-agent' && schemaMode === 'open') return 'mcp-open-schema';
  if (producer === 'mcp-agent' && schemaMode === 'known') return 'mcp-known-schema';
  return `${schemaMode}-schema`;
}

function normalizeBaselineStrategy(value) {
  if (BASELINE_STRATEGIES.has(value)) return value;
  return 'none';
}

function uniqueStrings(values, label) {
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${label} must contain only non-empty strings.`);
    }
    if (!result.includes(value)) result.push(value);
  }
  return result.sort(compareString);
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort(compareString);
}

function compareDefinitionRows(left, right) {
  return (
    compareString(left.slug, right.slug) ||
    compareString(left.namespace, right.namespace) ||
    compareString(left.id, right.id)
  );
}

function compareString(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sanitizeUrlForArtifact(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}
