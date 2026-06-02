export function buildStoredPreferencesArtifact({
  userId,
  corpusId,
  graphqlUrl,
  locationId,
  includeSuggestions,
  ingestionMode,
  suggestionsWereAutoApplied,
  runId,
  responseData,
  exportedAt,
}) {
  assertAuthenticatedUser(responseData, userId);

  const activeRows = normalizeRows({
    rows: responseData.activePreferences,
    expectedUserId: userId,
    expectedStatus: 'ACTIVE',
    label: 'activePreferences',
  });

  const suggestedRows = includeSuggestions
    ? normalizeRows({
        rows: responseData.suggestedPreferences,
        expectedUserId: userId,
        expectedStatus: 'SUGGESTED',
        label: 'suggestedPreferences',
      })
    : [];

  const artifact = {
    schemaVersion: 1,
    artifactType: 'stored-preferences',
    ...(runId ? { runId } : {}),
    userId,
    corpusId,
    storageInput: {
      ...(ingestionMode ? { ingestionMode } : {}),
      statusesScored: ['ACTIVE'],
      ...(suggestionsWereAutoApplied === undefined
        ? {}
        : { suggestionsWereAutoApplied }),
    },
    preferences: sortPreferenceRows(activeRows),
    ...(includeSuggestions ? { suggestions: sortPreferenceRows(suggestedRows) } : {}),
    diagnostics: {
      exportedAt,
      graphqlUrl,
      queryName: 'EvalStoredPreferencesExport',
      locationMode: locationId ? 'merged-location' : 'global-only',
      locationId: locationId ?? null,
      activePreferenceCount: activeRows.length,
      suggestedPreferenceCount: suggestedRows.length,
      includeSuggestions,
    },
  };

  return artifact;
}

export function normalizeRows({ rows, expectedUserId, expectedStatus, label }) {
  if (!Array.isArray(rows)) {
    throw new Error(`GraphQL ${label} response must be an array.`);
  }
  return rows.map((row, index) =>
    normalizePreferenceRow({
      row,
      index,
      expectedUserId,
      expectedStatus,
      label,
    }),
  );
}

export function normalizePreferenceRow({
  row,
  index,
  expectedUserId,
  expectedStatus,
  label,
}) {
  const path = `${label}[${index}]`;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`GraphQL ${path} must be an object.`);
  }

  for (const key of ['id', 'userId', 'slug', 'definitionId', 'status', 'sourceType']) {
    if (typeof row[key] !== 'string' || row[key].length === 0) {
      throw new Error(`GraphQL ${path}.${key} must be a non-empty string.`);
    }
  }
  for (const key of ['createdAt', 'updatedAt']) {
    if (typeof row[key] !== 'string' || row[key].length === 0) {
      throw new Error(`GraphQL ${path}.${key} must be a non-empty string.`);
    }
  }
  if (!Object.hasOwn(row, 'value')) {
    throw new Error(`GraphQL ${path}.value is missing.`);
  }
  if (row.userId !== expectedUserId) {
    throw new Error(
      `GraphQL ${path}.userId ${row.userId} does not match expected user ${expectedUserId}.`,
    );
  }
  if (row.status !== expectedStatus) {
    throw new Error(
      `GraphQL ${path}.status ${row.status} does not match expected status ${expectedStatus}.`,
    );
  }
  if (
    row.locationId !== null &&
    row.locationId !== undefined &&
    typeof row.locationId !== 'string'
  ) {
    throw new Error(`GraphQL ${path}.locationId must be a string or null.`);
  }
  if (
    row.confidence !== null &&
    row.confidence !== undefined &&
    (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1)
  ) {
    throw new Error(`GraphQL ${path}.confidence must be a number from 0 to 1 or null.`);
  }

  return {
    id: row.id,
    userId: row.userId,
    locationId: row.locationId ?? null,
    slug: row.slug,
    definitionId: row.definitionId,
    value: row.value,
    status: row.status,
    sourceType: row.sourceType,
    confidence: row.confidence ?? null,
    evidence: row.evidence ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function sortPreferenceRows(rows) {
  return [...rows].sort(comparePreferenceRows);
}

function assertAuthenticatedUser(responseData, expectedUserId) {
  const actualUserId = responseData?.me?.userId;
  if (typeof actualUserId !== 'string' || actualUserId.length === 0) {
    throw new Error('GraphQL export response did not include me.userId.');
  }
  if (actualUserId !== expectedUserId) {
    throw new Error(
      `Authenticated GraphQL user ${actualUserId} does not match requested user ${expectedUserId}.`,
    );
  }
}

function comparePreferenceRows(left, right) {
  return (
    compareString(left.slug, right.slug) ||
    compareString(left.locationId ?? '', right.locationId ?? '') ||
    compareString(left.id, right.id)
  );
}

function compareString(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
