/** Application-owned persisted data. Values and enum declaration order are public contracts. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonInput =
  | string
  | number
  | boolean
  | null
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput | undefined };

export const LocationType = {
  HOME: "HOME",
  WORK: "WORK",
  OTHER: "OTHER",
} as const;

export type LocationType = (typeof LocationType)[keyof typeof LocationType];

export const PreferenceValueType = {
  STRING: "STRING",
  BOOLEAN: "BOOLEAN",
  ENUM: "ENUM",
  ARRAY: "ARRAY",
} as const;

export type PreferenceValueType =
  (typeof PreferenceValueType)[keyof typeof PreferenceValueType];

export const PreferenceScope = {
  GLOBAL: "GLOBAL",
  LOCATION: "LOCATION",
} as const;

export type PreferenceScope =
  (typeof PreferenceScope)[keyof typeof PreferenceScope];

export const PreferenceStatus = {
  ACTIVE: "ACTIVE",
  SUGGESTED: "SUGGESTED",
  REJECTED: "REJECTED",
} as const;

export type PreferenceStatus =
  (typeof PreferenceStatus)[keyof typeof PreferenceStatus];

export const SourceType = {
  USER: "USER",
  INFERRED: "INFERRED",
  IMPORTED: "IMPORTED",
  SYSTEM: "SYSTEM",
} as const;

export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const AuditTargetType = {
  PREFERENCE: "PREFERENCE",
  PREFERENCE_DEFINITION: "PREFERENCE_DEFINITION",
} as const;

export type AuditTargetType =
  (typeof AuditTargetType)[keyof typeof AuditTargetType];

export const AuditActorType = {
  USER: "USER",
  MCP_CLIENT: "MCP_CLIENT",
  SYSTEM: "SYSTEM",
  WORKFLOW: "WORKFLOW",
  IMPORT: "IMPORT",
} as const;

export type AuditActorType =
  (typeof AuditActorType)[keyof typeof AuditActorType];

export const AuditOrigin = {
  GRAPHQL: "GRAPHQL",
  MCP: "MCP",
  DOCUMENT_ANALYSIS: "DOCUMENT_ANALYSIS",
  WORKFLOW: "WORKFLOW",
  SYSTEM: "SYSTEM",
} as const;

export type AuditOrigin = (typeof AuditOrigin)[keyof typeof AuditOrigin];

export const AuditEventType = {
  PREFERENCES_RESET: "PREFERENCES_RESET",
  PREFERENCE_SET: "PREFERENCE_SET",
  PREFERENCE_SUGGESTED_UPSERTED: "PREFERENCE_SUGGESTED_UPSERTED",
  PREFERENCE_SUGGESTION_ACCEPTED: "PREFERENCE_SUGGESTION_ACCEPTED",
  PREFERENCE_SUGGESTION_REJECTED: "PREFERENCE_SUGGESTION_REJECTED",
  PREFERENCE_DELETED: "PREFERENCE_DELETED",
  DEFINITION_CREATED: "DEFINITION_CREATED",
  DEFINITION_UPDATED: "DEFINITION_UPDATED",
  DEFINITION_ARCHIVED: "DEFINITION_ARCHIVED",
} as const;

export type AuditEventType =
  (typeof AuditEventType)[keyof typeof AuditEventType];

export const McpAccessSurface = {
  TOOLS_CALL: "TOOLS_CALL",
  RESOURCES_READ: "RESOURCES_READ",
} as const;

export type McpAccessSurface =
  (typeof McpAccessSurface)[keyof typeof McpAccessSurface];

export const McpAccessOutcome = {
  SUCCESS: "SUCCESS",
  DENY: "DENY",
  ERROR: "ERROR",
} as const;

export type McpAccessOutcome =
  (typeof McpAccessOutcome)[keyof typeof McpAccessOutcome];

export const GrantAction = {
  READ: "READ",
  SUGGEST: "SUGGEST",
  WRITE: "WRITE",
  DEFINE: "DEFINE",
} as const;

export type GrantAction = (typeof GrantAction)[keyof typeof GrantAction];

export const GrantEffect = {
  ALLOW: "ALLOW",
  DENY: "DENY",
} as const;

export type GrantEffect = (typeof GrantEffect)[keyof typeof GrantEffect];

export interface User {
  userId: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: string;
  issuer: string;
  providerUserId: string;
  metadata: JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Location {
  locationId: string;
  userId: string;
  type: LocationType;
  label: string;
  address: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PreferenceDefinition {
  id: string;
  namespace: string;
  slug: string;
  displayName: string | null;
  description: string;
  valueType: PreferenceValueType;
  scope: PreferenceScope;
  options: JsonValue | null;
  isSensitive: boolean;
  isCore: boolean;
  archivedAt: Date | null;
  ownerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Preference {
  id: string;
  userId: string;
  locationId: string | null;
  contextKey: string;
  definitionId: string;
  value: JsonValue;
  status: PreferenceStatus;
  sourceType: SourceType;
  confidence: number | null;
  evidence: JsonValue | null;
  lastActorType: AuditActorType | null;
  lastActorClientKey: string | null;
  lastOrigin: AuditOrigin | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PreferenceAuditEvent {
  id: string;
  userId: string;
  subjectSlug: string;
  occurredAt: Date;
  targetType: AuditTargetType;
  targetId: string;
  eventType: AuditEventType;
  actorType: AuditActorType;
  actorClientKey: string | null;
  origin: AuditOrigin;
  correlationId: string;
  beforeState: JsonValue | null;
  afterState: JsonValue | null;
  metadata: JsonValue | null;
}

export interface McpAccessEvent {
  id: string;
  userId: string;
  clientKey: string;
  occurredAt: Date;
  surface: McpAccessSurface;
  operationName: string;
  outcome: McpAccessOutcome;
  correlationId: string;
  latencyMs: number;
  requestMetadata: JsonValue | null;
  responseMetadata: JsonValue | null;
  errorMetadata: JsonValue | null;
}

export interface PermissionGrant {
  id: string;
  userId: string;
  clientKey: string;
  target: string;
  action: GrantAction;
  effect: GrantEffect;
  createdAt: Date;
  updatedAt: Date;
}
