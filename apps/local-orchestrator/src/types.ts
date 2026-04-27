export type AnalysisStatus =
  | 'success'
  | 'no_matches'
  | 'parse_error'
  | 'ai_error';

export type AnalysisRecordStatus = AnalysisStatus | 'request_error';

export type PreferenceOperation = 'CREATE' | 'UPDATE';

export type FilterReason =
  | 'MISSING_FIELDS'
  | 'DUPLICATE_KEY'
  | 'NO_CHANGE'
  | 'UNKNOWN_SLUG';

export interface SourceMeta {
  page?: number;
  line?: number;
  filename?: string;
}

export interface PreferenceSuggestion {
  id: string;
  slug: string;
  operation: PreferenceOperation;
  oldValue?: unknown;
  newValue: unknown;
  confidence: number;
  sourceSnippet: string;
  sourceMeta?: SourceMeta;
  wasCorrected?: boolean;
  category?: string;
  description?: string;
}

export interface FilteredSuggestion extends PreferenceSuggestion {
  filterReason: FilterReason;
  filterDetails?: string;
}

export interface DocumentAnalysisResult {
  analysisId: string;
  suggestions: PreferenceSuggestion[];
  filteredSuggestions: FilteredSuggestion[];
  documentSummary?: string | null;
  status: AnalysisStatus;
  statusReason?: string | null;
  filteredCount: number;
}

export interface DiscoveredFile {
  path: string;
  relativePath: string;
  sizeBytes: number;
  extension: string;
  originalMimeType: string | null;
  uploadMimeType: string;
  uploadFileName: string;
  coercedToPlainText: boolean;
}

export interface DiscoveryDecision {
  action: 'analyze' | 'skip';
  reason: string;
  details?: string;
}

export interface FileFilterDecision {
  action: 'analyze' | 'skip';
  reason: string;
  score?: number;
}

export interface SuggestionDecision {
  suggestionId: string;
  action: 'apply' | 'skip';
  reason: string;
  score?: number;
}

export interface RequestErrorRecord {
  kind: 'http' | 'network' | 'timeout' | 'invalid_response' | 'auth' | 'graphql';
  message: string;
  statusCode?: number;
}

export interface AnalysisRecord {
  attempted: boolean;
  status: AnalysisRecordStatus;
  statusReason?: string | null;
  analysisId?: string;
  documentSummary?: string | null;
  suggestions: PreferenceSuggestion[];
  filteredSuggestions: FilteredSuggestion[];
  filteredCount: number;
  error?: RequestErrorRecord;
}

export interface ApplyInputSuggestion {
  suggestionId: string;
  slug: string;
  operation: PreferenceOperation;
  newValue?: unknown;
  confidence?: number;
  evidence?: Record<string, unknown>;
}

export interface AppliedPreferenceRecord {
  id: string;
  slug: string;
  value: unknown;
  status?: string;
  sourceType?: string;
}

export interface ApplyBatchResult {
  analysisId: string;
  requestedCount: number;
  appliedCount: number;
  matchedSuggestionIds: string[];
  unmatchedSuggestionIds: string[];
  ambiguousSuggestionIds: string[];
  appliedPreferences: AppliedPreferenceRecord[];
  error?: string;
}

export interface FileRunRecord {
  file?: DiscoveredFile;
  path: string;
  relativePath: string;
  sizeBytes?: number;
  extension?: string;
  originalMimeType?: string | null;
  uploadMimeType?: string | null;
  discovery: DiscoveryDecision;
  fileFilter?: FileFilterDecision;
  analysis?: AnalysisRecord;
  suggestionDecisions?: SuggestionDecision[];
  apply?: ApplyBatchResult;
}

export interface RunConfig {
  folder: string;
  backendUrl: string;
  apply: boolean;
  concurrency: number;
  fileFilter: string;
  suggestionFilter: string;
}

export interface RunSummary {
  discoveredVisibleFiles: number;
  hiddenEntriesSkipped: number;
  unsupportedFilesSkipped: number;
  skippedByFileFilter: number;
  analysisAttempted: number;
  analysisSucceeded: number;
  analysisNoMatches: number;
  analysisParseErrors: number;
  analysisAiErrors: number;
  analysisRequestErrors: number;
  backendFilteredSuggestions: number;
  validSuggestionsFound: number;
  suggestionsAccepted: number;
  suggestionsSkippedByFilter: number;
  applyRequested: number;
  applyMatched: number;
  applyUnmatched: number;
  applyAmbiguous: number;
  hasFailures: boolean;
}

export interface RunManifest {
  version: 1;
  startedAt: string;
  finishedAt: string;
  config: RunConfig;
  hiddenEntriesSkipped: number;
  files: FileRunRecord[];
  summary: RunSummary;
}

export interface CliOptions {
  folder: string;
  backendUrl: string;
  token: string;
  apply: boolean;
  concurrency: number;
  out?: string;
  fileFilter: 'passthrough';
  suggestionFilter: 'passthrough';
}
