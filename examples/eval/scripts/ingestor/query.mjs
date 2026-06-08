export const INGESTOR_GRAPHQL_DOCUMENTS = [
  `
query EvalIngestorMe {
  me {
    userId
  }
}
`,
  `
mutation EvalIngestorResetMemory($mode: ResetMemoryMode!) {
  resetMyMemory(mode: $mode) {
    mode
    preferencesDeleted
    preferenceDefinitionsDeleted
    locationsDeleted
    preferenceAuditEventsDeleted
    mcpAccessEventsDeleted
    permissionGrantsDeleted
  }
}
`,
  `
query EvalIngestorPreferenceSchema($scope: ExportSchemaScope!) {
  exportPreferenceSchema(scope: $scope) {
    id
    slug
    valueType
    scope
    ownerUserId
    archivedAt
  }
}
`,
  `
mutation EvalIngestorCreateDefinition($input: CreatePreferenceDefinitionInput!) {
  createPreferenceDefinition(input: $input) {
    id
    slug
    valueType
    scope
    ownerUserId
  }
}
`,
  `
mutation EvalIngestorSetPreference($input: SetPreferenceInput!) {
  setPreference(input: $input) {
    id
    slug
    value
    status
  }
}
`,
  `
mutation EvalIngestorApplySuggestions(
  $analysisId: ID!
  $input: [ApplyPreferenceSuggestionInput!]!
) {
  applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
    id
    slug
    value
    status
  }
}
`,
];

export const [
  ME_QUERY,
  RESET_MEMORY_MUTATION,
  EXPORT_SCHEMA_QUERY,
  CREATE_DEFINITION_MUTATION,
  SET_PREFERENCE_MUTATION,
  APPLY_SUGGESTIONS_MUTATION,
] = INGESTOR_GRAPHQL_DOCUMENTS;
