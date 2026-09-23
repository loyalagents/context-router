import type {
  JsonInput,
  PreferenceScope,
  PreferenceValueType,
} from "./storage-types";

export interface CatalogDefinitionData {
  displayName: string | null;
  description: string;
  valueType: PreferenceValueType;
  scope: PreferenceScope;
  options: JsonInput | null;
  isSensitive: boolean;
  isCore: true;
}
/** Each command persists independently; catalog initialization deliberately permits partial-prefix completion. */
export interface CatalogStorage {
  findActiveGlobal(slug: string): Promise<{ id: string } | null>;
  updateGlobal(id: string, data: CatalogDefinitionData): Promise<void>;
  countActivePersonalCollisions(slug: string): Promise<number>;
  createGlobal(slug: string, data: CatalogDefinitionData): Promise<void>;
}
