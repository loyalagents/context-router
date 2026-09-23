import type {
  JsonInput,
  JsonValue,
} from "@/domains/shared/storage/storage-types";

type TimestampLike = Date | string;

interface PreferenceAuditSnapshotInput {
  id: string;
  userId: string;
  definitionId: string;
  slug: string;
  category?: string;
  description?: string;
  contextKey: string;
  locationId: string | null;
  value: JsonValue;
  status: string;
  sourceType: string;
  confidence: number | null;
  evidence: JsonValue | null;
  lastModifiedBy?: {
    actorType: string;
    actorClientKey?: string | null;
    origin: string;
  } | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

interface PreferenceDefinitionAuditSnapshotInput {
  id: string;
  namespace: string;
  slug: string;
  displayName: string | null;
  description: string;
  valueType: string;
  scope: string;
  options: JsonValue | null;
  isSensitive: boolean;
  isCore: boolean;
  archivedAt: TimestampLike | null;
  ownerUserId: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

function serializeTimestamp(value: TimestampLike | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

export function buildPreferenceAuditSnapshot(
  preference: PreferenceAuditSnapshotInput,
): { [key: string]: JsonInput } {
  return {
    id: preference.id,
    userId: preference.userId,
    definitionId: preference.definitionId,
    slug: preference.slug,
    contextKey: preference.contextKey,
    locationId: preference.locationId,
    value: preference.value,
    status: preference.status,
    sourceType: preference.sourceType,
    confidence: preference.confidence,
    evidence: preference.evidence == null ? null : preference.evidence,
    lastModifiedBy:
      preference.lastModifiedBy == null ? null : preference.lastModifiedBy,
    createdAt: serializeTimestamp(preference.createdAt),
    updatedAt: serializeTimestamp(preference.updatedAt),
  };
}

export function buildPreferenceDefinitionAuditSnapshot(
  definition: PreferenceDefinitionAuditSnapshotInput,
): { [key: string]: JsonInput } {
  return {
    id: definition.id,
    namespace: definition.namespace,
    slug: definition.slug,
    displayName: definition.displayName,
    description: definition.description,
    valueType: definition.valueType,
    scope: definition.scope,
    options: definition.options == null ? null : definition.options,
    isSensitive: definition.isSensitive,
    isCore: definition.isCore,
    archivedAt: serializeTimestamp(definition.archivedAt),
    ownerUserId: definition.ownerUserId,
    createdAt: serializeTimestamp(definition.createdAt),
    updatedAt: serializeTimestamp(definition.updatedAt),
  };
}
