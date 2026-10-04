import type { StorageScope } from '@/domains/shared/storage/storage-unit-of-work';
import type { AuditEventInput } from './audit.types';
import type { PreferenceAuditService } from './preference-audit.service';

export type EventSensitivity = 'SENSITIVE' | 'NON_SENSITIVE' | 'UNKNOWN';
const object = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;

/** Legacy/malformed markers are never inferred from today's catalog. */
export function eventSensitivity(metadata: unknown): EventSensitivity {
  const marker = object(object(metadata)?.eventSensitivity);
  return marker?.schemaVersion === 1 &&
    Object.keys(marker).length === 2 &&
    ['SENSITIVE', 'NON_SENSITIVE', 'UNKNOWN'].includes(marker.classification)
    ? marker.classification
    : 'UNKNOWN';
}

/** Construct only with facets owned by the same transaction as the mutation. */
export class EventTimeAudit implements PreferenceAuditService {
  constructor(
    private readonly sink: PreferenceAuditService,
    private readonly definitions: StorageScope['definitions'],
  ) {}
  async record(event: AuditEventInput): Promise<void> {
    const metadata = object(event.metadata);
    const states = [
      event.beforeState,
      event.afterState,
      metadata?.consumedSuggestion,
    ].filter((state) => state != null);
    const sensitivity: EventSensitivity[] = [];
    for (const state of states) {
      const snapshot = object(state);
      if (event.targetType === 'PREFERENCE_DEFINITION') {
        sensitivity.push(
          typeof snapshot?.isSensitive === 'boolean'
            ? snapshot.isSensitive
              ? 'SENSITIVE'
              : 'NON_SENSITIVE'
            : 'UNKNOWN',
        );
      } else if (typeof snapshot?.definitionId === 'string') {
        const definition = await this.definitions.getDefinitionById(
          snapshot.definitionId,
        );
        sensitivity.push(
          !definition ||
            (definition.ownerUserId && definition.ownerUserId !== event.userId)
            ? 'UNKNOWN'
            : definition.isSensitive
              ? 'SENSITIVE'
              : 'NON_SENSITIVE',
        );
      } else sensitivity.push('UNKNOWN');
    }
    const classification: EventSensitivity = sensitivity.includes('SENSITIVE')
      ? 'SENSITIVE'
      : !sensitivity.length || sensitivity.includes('UNKNOWN')
        ? 'UNKNOWN'
        : 'NON_SENSITIVE';
    await this.sink.record({
      ...event,
      metadata: {
        ...(metadata ??
          (event.metadata == null ? {} : { originalMetadata: event.metadata })),
        eventSensitivity: { schemaVersion: 1, classification },
      },
    });
  }
}
