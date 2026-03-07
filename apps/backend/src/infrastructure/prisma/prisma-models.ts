import {
  LocationType,
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

export interface ApiKey {
  id: string;
  keyHash: string;
  groupName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyUser {
  id: string;
  apiKeyId: string;
  userId: string;
  createdAt: Date;
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
