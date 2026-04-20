import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
  LocationType,
  McpAccessOutcome,
  McpAccessSurface,
  PreferenceScope,
  PreferenceStatus,
  PreferenceValueType,
  SourceType,
} from "./generated-client";

export interface User {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  metadata: unknown | null;
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
  options: unknown | null;
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
  value: unknown;
  status: PreferenceStatus;
  sourceType: SourceType;
  confidence: number | null;
  evidence: unknown | null;
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
  beforeState: unknown | null;
  afterState: unknown | null;
  metadata: unknown | null;
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
  requestMetadata: unknown | null;
  responseMetadata: unknown | null;
  errorMetadata: unknown | null;
}
