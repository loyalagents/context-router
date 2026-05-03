export interface PreferenceAttribution {
  actorType: string;
  actorClientKey: string | null;
  origin: string;
}

export interface Preference {
  id: string;
  slug: string;
  definitionId: string;
  value: any;
  status: string;
  sourceType: string;
  lastModifiedBy?: PreferenceAttribution | null;
  confidence: number | null;
  locationId: string | null;
  category?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
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

export type FilterReason =
  | 'MISSING_FIELDS'
  | 'DUPLICATE_KEY'
  | 'NO_CHANGE'
  | 'UNKNOWN_SLUG';

export interface PreferenceSuggestion {
  id: string;
  slug: string;
  operation: 'CREATE' | 'UPDATE';
  oldValue: any;
  newValue: any;
  confidence: number;
  sourceSnippet: string;
  sourceMeta?: {
    page?: number;
    line?: number;
  };
  wasCorrected?: boolean;
  category?: string;
  description?: string;
}

export interface FilteredSuggestion extends PreferenceSuggestion {
  filterReason: FilterReason;
  filterDetails?: string;
}

export type DocumentAnalysisStatus =
  | 'success'
  | 'no_matches'
  | 'parse_error'
  | 'ai_error';

export interface DocumentAnalysisResult {
  analysisId: string;
  suggestions: PreferenceSuggestion[];
  filteredSuggestions: FilteredSuggestion[];
  documentSummary: string | null;
  status: DocumentAnalysisStatus;
  statusReason: string | null;
  filteredCount?: number;
}

export type UploadFileStatus =
  | 'queued'
  | 'analyzing'
  | DocumentAnalysisStatus
  | 'validation_error'
  | 'upload_error';

export interface UploadBatchFileResult {
  id: string;
  fileName: string;
  fileSize: number;
  status: UploadFileStatus;
  result?: DocumentAnalysisResult;
  error?: string;
}

export interface UploadBatchResult {
  files: UploadBatchFileResult[];
}
