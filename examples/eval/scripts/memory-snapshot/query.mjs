export const EXPORT_MEMORY_SNAPSHOT_QUERY = `
query EvalMemorySnapshotExport($locationId: ID, $includeSuggestions: Boolean!) {
  me {
    userId
  }
  activePreferences(locationId: $locationId) {
    ...EvalMemorySnapshotPreferenceFields
  }
  suggestedPreferences(locationId: $locationId) @include(if: $includeSuggestions) {
    ...EvalMemorySnapshotPreferenceFields
  }
  exportPreferenceSchema(scope: ALL) {
    id
    namespace
    slug
    displayName
    ownerUserId
    archivedAt
    description
    valueType
    scope
    options
    isSensitive
    isCore
    category
  }
}

fragment EvalMemorySnapshotPreferenceFields on Preference {
  id
  userId
  locationId
  slug
  definitionId
  value
  status
  sourceType
  confidence
  evidence
  createdAt
  updatedAt
}
`;
