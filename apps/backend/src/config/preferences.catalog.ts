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

import rawCatalogData = require('./preferences.catalog.json');

// Evidence schema for provenance tracking
export interface PreferenceEvidence {
  messageIds?: string[]; // IDs of messages that led to this inference
  snippets?: string[]; // Relevant text snippets from the conversation
  modelVersion?: string; // Model that made the inference (e.g., "gpt-4o")
  inferredAt?: string; // ISO timestamp of when inference was made
  reason?: string; // Brief explanation of why this was inferred
}

export type PreferenceValueType = 'string' | 'boolean' | 'enum' | 'array';

export interface PreferenceDefinition {
  category: string; // UI grouping only (system/food/dev/etc.)
  displayName?: string; // optional UI/agent-facing label
  description: string; // LLM-facing meaning + how to apply
  valueType: PreferenceValueType;
  options?: string[]; // for enum type
  scope: 'global' | 'location'; // enforce locationId usage
  isSensitive?: boolean; // future: redact from prompt by default
}

/**
 * The canonical catalog of all valid preference slugs.
 * Used by seed.ts and test-db.ts to populate the preference_definitions table.
 */
const catalogData =
  'default' in rawCatalogData ? rawCatalogData.default : rawCatalogData;

export const PREFERENCE_CATALOG =
  catalogData as Record<string, PreferenceDefinition>;
