export const GROUP_USERS_QUERY = `
  query GroupUsers($apiKey: String!) {
    groupUsers(apiKey: $apiKey) {
      userId
      email
      firstName
      lastName
      createdAt
      updatedAt
    }
  }
`;

export const ME_QUERY = `
  query Me {
    me {
      userId
      email
      firstName
      lastName
      createdAt
      updatedAt
    }
  }
`;

export const EXPORT_PREFERENCE_SCHEMA_QUERY = `
  query ExportPreferenceSchema($scope: ExportSchemaScope!) {
    exportPreferenceSchema(scope: $scope) {
      slug
      displayName
      ownerUserId
      description
      valueType
      scope
      options
    }
  }
`;

export const ACTIVE_PREFERENCES_QUERY = `
  query ActivePreferences {
    activePreferences {
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
      category
      description
    }
  }
`;

export const SET_PREFERENCE_MUTATION = `
  mutation SetPreference($input: SetPreferenceInput!) {
    setPreference(input: $input) {
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
      category
      description
    }
  }
`;
