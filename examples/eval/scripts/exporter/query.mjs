export const EXPORT_STORED_PREFERENCES_QUERY = `
query EvalStoredPreferencesExport($locationId: ID, $includeSuggestions: Boolean!) {
  me {
    userId
  }
  activePreferences(locationId: $locationId) {
    ...EvalStoredPreferenceFields
  }
  suggestedPreferences(locationId: $locationId) @include(if: $includeSuggestions) {
    ...EvalStoredPreferenceFields
  }
}

fragment EvalStoredPreferenceFields on Preference {
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
