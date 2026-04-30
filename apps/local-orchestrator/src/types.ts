export type AnalysisStatus =
  | 'success'
  | 'no_matches'
  | 'parse_error'
  | 'ai_error';

export type AnalysisRecordStatus = AnalysisStatus | 'request_error';

export type PreferenceOperation = 'CREATE' | 'UPDATE';

export type AIFilterStage = 'suggestion' | 'file' | 'both';

export type AIFilterAdapter = 'command';

export type AIFilterFailurePolicy = 'dry-run-passthrough_apply-skip';

export type DecisionSource = 'passthrough' | 'ai' | 'fallback' | 'bypass';

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
  details?: string;
  source?: DecisionSource;
  promptVersion?: string | null;
}

export interface SuggestionDecision {
  suggestionId: string;
  action: 'apply' | 'skip';
  reason: string;
  score?: number;
  details?: string;
  source?: Exclude<DecisionSource, 'bypass'>;
  promptVersion?: string | null;
}

export interface RequestErrorRecord {
  kind:
    | 'http'
    | 'network'
    | 'timeout'
    | 'invalid_response'
    | 'auth'
    | 'graphql'
    | 'process';
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

export interface FilterAuditRecord {
  stage: 'suggestion';
  adapter: AIFilterAdapter;
  goal: string;
  decision: 'apply' | 'skip';
  score?: number;
  reason: string;
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

export interface AIStageRecord {
  promptVersion?: string | null;
  adapterError?: RequestErrorRecord;
  usedFallback?: boolean;
  applySkipped?: boolean;
  bypassReason?: string | null;
}

export interface FileAIRunRecord {
  fileStage?: AIStageRecord;
  suggestionStage?: AIStageRecord;
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
  ai?: FileAIRunRecord;
}

export interface AIFilterConfig {
  enabled: boolean;
  stage: AIFilterStage | null;
  adapter: AIFilterAdapter | null;
  command: string | null;
  goal: string | null;
  timeoutMs: number | null;
  promptVersion: string | null;
  failurePolicy: AIFilterFailurePolicy | null;
}

export interface RunConfig {
  folder: string;
  backendUrl: string;
  apply: boolean;
  concurrency: number;
  includeHidden: boolean;
  aiFilter: AIFilterConfig;
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
  aiFilesEvaluated: number;
  aiFilesSkipped: number;
  aiFilesBypassed: number;
  aiSuggestionsAccepted: number;
  aiSuggestionsSkipped: number;
  fallbackSuggestionsAccepted: number;
  aiAdapterFailures: number;
  aiApplySkippedFiles: number;
  degradedByAiFallback: boolean;
  hasFailures: boolean;
}

export interface RunManifest {
  version: 3;
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
  includeHidden: boolean;
  out?: string;
  aiFilter: boolean;
  aiFilterStage: AIFilterStage;
  aiAdapter: AIFilterAdapter;
  aiCommand?: string;
  aiGoal?: string;
  aiTimeoutMs: number;
}

export interface BatchSuggestionFilterContext {
  file: DiscoveredFile;
  analysis: DocumentAnalysisResult;
  suggestions: PreferenceSuggestion[];
}
