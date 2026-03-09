export type WorkshopValueType = "STRING" | "BOOLEAN" | "ENUM" | "ARRAY";
export type WorkshopPreferenceStatus = "ACTIVE" | "SUGGESTED" | "REJECTED";
export type WorkshopSourceType = "USER" | "INFERRED" | "IMPORTED" | "SYSTEM";
export type WorkshopAnalysisStatus =
  | "success"
  | "no_matches"
  | "parse_error"
  | "ai_error";
export type WorkshopPreferenceOperation = "CREATE" | "UPDATE";
export type WorkshopFilterReason =
  | "MISSING_FIELDS"
  | "DUPLICATE_KEY"
  | "NO_CHANGE"
  | "UNKNOWN_SLUG";
export type WorkshopCatalogOrigin = "system" | "personal";
export type WorkshopErrorKind = "config" | "network" | "http" | "graphql";
export type WorkshopFetch = typeof globalThis.fetch;

export interface WorkshopClientConfig {
  baseUrl: string;
  apiKey: string;
  graphqlUrl?: string;
  uploadUrl?: string;
  fetch?: WorkshopFetch;
}

export interface WorkshopUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkshopCatalogEntry {
  slug: string;
  displayName?: string;
  description: string;
  valueType: WorkshopValueType;
  options?: readonly string[];
  origin: WorkshopCatalogOrigin;
}

export interface WorkshopPreference {
  id: string;
  userId: string;
  locationId?: string;
  slug: string;
  definitionId: string;
  value: unknown;
  status: WorkshopPreferenceStatus;
  sourceType: WorkshopSourceType;
  confidence?: number;
  evidence?: unknown;
  createdAt: string;
  updatedAt: string;
  category?: string;
  description?: string;
}

export interface WorkshopSourceMeta {
  page?: number;
  line?: number;
  filename?: string;
}

export interface WorkshopPreferenceSuggestion {
  id: string;
  slug: string;
  operation: WorkshopPreferenceOperation;
  oldValue?: unknown;
  newValue: unknown;
  confidence: number;
  sourceSnippet: string;
  sourceMeta?: WorkshopSourceMeta;
  wasCorrected: boolean;
  category?: string;
  description?: string;
}

export interface WorkshopFilteredSuggestion
  extends WorkshopPreferenceSuggestion {
  filterReason: WorkshopFilterReason;
  filterDetails?: string;
}

export interface WorkshopDocumentAnalysisResult {
  analysisId: string;
  suggestions: WorkshopPreferenceSuggestion[];
  filteredSuggestions: WorkshopFilteredSuggestion[];
  documentSummary?: string;
  status: WorkshopAnalysisStatus;
  statusReason?: string;
  filteredCount: number;
}

export interface WorkshopBaseClient {
  users(): Promise<WorkshopUser[]>;
  withUser(userId: string): WorkshopUserClient;
}

export interface WorkshopUserClient {
  catalog(): Promise<readonly WorkshopCatalogEntry[]>;
  me(): Promise<WorkshopUser>;
  activePreferences(): Promise<WorkshopPreference[]>;
  setPreference(input: {
    slug: string;
    value: unknown;
  }): Promise<WorkshopPreference>;
  analyzeDocument(input: {
    file: Blob;
    filename?: string;
  }): Promise<WorkshopDocumentAnalysisResult>;
}

export class WorkshopClientError extends Error {
  readonly kind: WorkshopErrorKind;
  readonly operation: string;
  readonly statusCode?: number;
  readonly raw?: unknown;

  constructor(input: {
    kind: WorkshopErrorKind;
    message: string;
    operation: string;
    statusCode?: number;
    raw?: unknown;
  }) {
    super(input.message);
    this.name = "WorkshopClientError";
    this.kind = input.kind;
    this.operation = input.operation;
    this.statusCode = input.statusCode;
    this.raw = input.raw;
  }
}
