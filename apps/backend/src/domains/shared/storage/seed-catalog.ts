import {
  PREFERENCE_CATALOG,
  type PreferenceDefinition,
} from "../../../config/preferences-catalog-data";
import { PreferenceValueType, PreferenceScope } from "./storage-types";
import type { CatalogDefinitionData, CatalogStorage } from "./catalog-storage";

const VALUE_TYPE_MAP: Record<string, PreferenceValueType> = {
  string: PreferenceValueType.STRING,
  boolean: PreferenceValueType.BOOLEAN,
  enum: PreferenceValueType.ENUM,
  array: PreferenceValueType.ARRAY,
};
const SCOPE_MAP: Record<string, PreferenceScope> = {
  global: PreferenceScope.GLOBAL,
  location: PreferenceScope.LOCATION,
};

/** Existing catalog semantics: active ID reuse, personal precedence, retained archives/stale globals, per-entry commits. */
export async function seedCatalog(
  storage: CatalogStorage,
  catalog: Readonly<Record<string, PreferenceDefinition>> = PREFERENCE_CATALOG,
): Promise<void> {
  console.log("Seeding preference definitions...");
  for (const [slug, definition] of Object.entries(catalog)) {
    const existing = await storage.findActiveGlobal(slug);
    const data: CatalogDefinitionData = {
      displayName: definition.displayName ?? null,
      description: definition.description,
      valueType: VALUE_TYPE_MAP[definition.valueType],
      scope: SCOPE_MAP[definition.scope],
      options: definition.options ?? null,
      isSensitive: definition.isSensitive ?? false,
      isCore: true,
    };
    if (existing) await storage.updateGlobal(existing.id, data);
    else {
      const collidingCount = await storage.countActivePersonalCollisions(slug);
      if (collidingCount > 0)
        console.warn(
          `[seed] GLOBAL slug "${slug}" collides with ${collidingCount} active user definition(s). Global definition created; user defs take precedence for affected users.`,
        );
      await storage.createGlobal(slug, data);
    }
  }
  console.log(`Seeded ${Object.keys(catalog).length} preference definitions`);
}
