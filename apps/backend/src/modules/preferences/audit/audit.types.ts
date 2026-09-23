import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
  JsonInput,
  SourceType,
} from "@/domains/shared/storage/storage-types";

export interface AuditEventInput {
  userId: string;
  subjectSlug: string;
  targetType: AuditTargetType;
  targetId: string;
  eventType: AuditEventType;
  actorType: AuditActorType;
  actorClientKey?: string;
  origin: AuditOrigin;
  correlationId: string;
  beforeState?: JsonInput | null;
  afterState?: JsonInput | null;
  metadata?: JsonInput | null;
}

export interface MutationContext {
  actorType: AuditActorType;
  actorClientKey?: string;
  origin: AuditOrigin;
  correlationId: string;
  // sourceType governs the live row; other fields govern audit provenance.
  sourceType: SourceType;
  confidence?: number | null;
  evidence?: unknown;
}

export interface PreferenceMutationAttribution {
  actorType: AuditActorType;
  actorClientKey?: string | null;
  origin: AuditOrigin;
}

export interface PreferenceWriteResult<T> {
  result: T;
  beforeState: T | null;
}

export interface PreferenceProvenanceOptions {
  sourceType: SourceType;
  confidence?: number | null;
  evidence?: unknown;
}
