export interface Preference {
  id: string;
  userId?: string;
  slug: string;
  definitionId: string;
  value: any;
  status: string;
  sourceType: string;
  confidence: number | null;
  locationId: string | null;
  category?: string | null;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PreferenceDefinition {
  id: string;
  slug: string;
  namespace: string;
  displayName?: string | null;
  ownerUserId?: string | null;
  description: string;
  valueType: 'STRING' | 'BOOLEAN' | 'ENUM' | 'ARRAY';
  scope: 'GLOBAL' | 'LOCATION';
  options: string[] | null;
  isSensitive: boolean;
  isCore: boolean;
  category: string;
}

export interface MatchedPreferenceDefinition {
  slug: string;
  description: string;
  category: string;
}

export interface SmartSearchResult {
  queryInterpretation: string;
  matchedDefinitions: MatchedPreferenceDefinition[];
  matchedActivePreferences: Preference[];
  matchedSuggestedPreferences: Preference[];
}
