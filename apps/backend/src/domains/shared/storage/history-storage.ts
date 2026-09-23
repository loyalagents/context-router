import type {
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
  McpAccessOutcome,
  McpAccessSurface,
  PreferenceAuditEvent,
  McpAccessEvent,
  JsonInput,
} from "./storage-types";

export interface HistoryCursor {
  occurredAt: Date;
  id: string;
}
export interface HistoryRange {
  occurredFrom?: Date;
  occurredTo?: Date;
}
export interface AuditHistoryFilter extends HistoryRange {
  subjectSlug?: string;
  eventType?: AuditEventType;
  targetType?: AuditTargetType;
  origin?: AuditOrigin;
  actorClientKey?: string;
  correlationId?: string;
}
export interface AccessHistoryFilter extends HistoryRange {
  clientKey?: string;
  surface?: McpAccessSurface;
  operationName?: string;
  outcome?: McpAccessOutcome;
  correlationId?: string;
}
export interface AccessEvent {
  userId: string;
  clientKey: string;
  surface: McpAccessSurface;
  operationName: string;
  outcome: McpAccessOutcome;
  correlationId: string;
  latencyMs: number;
  requestMetadata?: JsonInput;
  responseMetadata?: JsonInput;
  errorMetadata?: JsonInput;
}
export abstract class AuditHistoryStorage {
  abstract findPage(
    userId: string,
    filter: AuditHistoryFilter,
    cursor: HistoryCursor | null,
    limit: number,
  ): Promise<PreferenceAuditEvent[]>;
}
export abstract class AccessHistoryStorage {
  abstract append(event: AccessEvent): Promise<void>;
  abstract findPage(
    userId: string,
    filter: AccessHistoryFilter,
    cursor: HistoryCursor | null,
    limit: number,
  ): Promise<McpAccessEvent[]>;
}
