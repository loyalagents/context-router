import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
  Prisma,
  SourceType,
} from "@infrastructure/prisma/generated-client";

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
  beforeState?: Prisma.InputJsonValue | null;
  afterState?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
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
