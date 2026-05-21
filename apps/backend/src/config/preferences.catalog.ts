/**
 * Preferences Catalog - Seed Data & Types
 *
 * This file defines the canonical set of preference definitions used to seed
 * the preference_definitions database table.
 *
 * Runtime query/validation logic has moved to:
 * - PreferenceDefinitionRepository (query, lookup, similarity)
 * - preference.validation.ts (validateValue, enforceScope, validateConfidence)
 */

export { PREFERENCE_CATALOG } from './preferences-catalog-data';
export type {
  PreferenceDefinition,
  PreferenceEvidence,
  PreferenceValueType,
} from './preferences-catalog-data';
