import { Prisma } from "@infrastructure/prisma/generated-client";

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
  value: unknown;
  status: string;
  sourceType: string;
  confidence: number | null;
  evidence: unknown | null;
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
  options: unknown | null;
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
): Prisma.InputJsonObject {
  return {
    id: preference.id,
    userId: preference.userId,
    definitionId: preference.definitionId,
    slug: preference.slug,
    contextKey: preference.contextKey,
    locationId: preference.locationId,
    value: preference.value as Prisma.InputJsonValue,
    status: preference.status,
    sourceType: preference.sourceType,
    confidence: preference.confidence,
    evidence:
      preference.evidence == null
        ? null
        : (preference.evidence as Prisma.InputJsonValue),
    createdAt: serializeTimestamp(preference.createdAt),
    updatedAt: serializeTimestamp(preference.updatedAt),
  };
}

export function buildPreferenceDefinitionAuditSnapshot(
  definition: PreferenceDefinitionAuditSnapshotInput,
): Prisma.InputJsonObject {
  return {
    id: definition.id,
    namespace: definition.namespace,
    slug: definition.slug,
    displayName: definition.displayName,
    description: definition.description,
    valueType: definition.valueType,
    scope: definition.scope,
    options:
      definition.options == null
        ? null
        : (definition.options as Prisma.InputJsonValue),
    isSensitive: definition.isSensitive,
    isCore: definition.isCore,
    archivedAt: serializeTimestamp(definition.archivedAt),
    ownerUserId: definition.ownerUserId,
    createdAt: serializeTimestamp(definition.createdAt),
    updatedAt: serializeTimestamp(definition.updatedAt),
  };
}
