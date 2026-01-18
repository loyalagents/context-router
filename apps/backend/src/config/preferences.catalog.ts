/**
 * Preferences Catalog - Code-First Registry
 *
 * This file defines all valid preference slugs, their types, and validation rules.
 * Unknown slugs are rejected to prevent drift and ensure LLM-safe preference management.
 */

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
  description: string; // LLM-facing meaning + how to apply
  valueType: PreferenceValueType;
  options?: string[]; // for enum type
  scope: 'global' | 'location'; // enforce locationId usage
  isSensitive?: boolean; // future: redact from prompt by default
}

/**
 * The canonical catalog of all valid preference slugs.
 * Format: category.subcategory or category.key_name
 * Regex: ^[a-z]+(\.[a-z0-9_]+)+$
 */
export const PREFERENCE_CATALOG: Record<string, PreferenceDefinition> = {
  'system.response_tone': {
    category: 'system',
    description:
      'The personality and formality level the AI should use when responding.',
    valueType: 'enum',
    options: ['casual', 'professional', 'concise', 'enthusiastic'],
    scope: 'global',
  },
  'system.response_length': {
    category: 'system',
    description:
      'Preferred length of AI responses - brief for quick answers, detailed for thorough explanations.',
    valueType: 'enum',
    options: ['brief', 'moderate', 'detailed'],
    scope: 'global',
  },
  'food.dietary_restrictions': {
    category: 'food',
    description:
      'Food allergies, intolerances, dislikes, or diet plans the user follows (e.g., vegetarian, vegan, gluten-free, kosher, halal).',
    valueType: 'array',
    scope: 'global',
  },
  'food.cuisine_preferences': {
    category: 'food',
    description:
      'Types of cuisine the user enjoys or prefers (e.g., Italian, Japanese, Mexican).',
    valueType: 'array',
    scope: 'global',
  },
  'food.spice_tolerance': {
    category: 'food',
    description: 'How much spice/heat the user prefers in their food.',
    valueType: 'enum',
    options: ['none', 'mild', 'medium', 'hot', 'extra_hot'],
    scope: 'global',
  },
  'dev.tech_stack': {
    category: 'dev',
    description:
      'Preferred programming languages, frameworks, and tools the user works with.',
    valueType: 'array',
    scope: 'global',
  },
  'dev.coding_style': {
    category: 'dev',
    description:
      'Coding conventions and style preferences (e.g., tabs vs spaces, naming conventions).',
    valueType: 'string',
    scope: 'global',
  },
  'travel.seat_preference': {
    category: 'travel',
    description: 'Preferred airplane seat location.',
    valueType: 'enum',
    options: ['window', 'middle', 'aisle'],
    scope: 'global',
  },
  'travel.meal_preference': {
    category: 'travel',
    description: 'Meal preference for flights and travel.',
    valueType: 'string',
    scope: 'global',
  },
  'communication.preferred_channels': {
    category: 'communication',
    description:
      'Preferred methods of communication (e.g., email, phone, text, slack).',
    valueType: 'array',
    scope: 'global',
  },
  'location.default_temperature': {
    category: 'location',
    description:
      'Preferred temperature setting for a specific location (in Fahrenheit).',
    valueType: 'string',
    scope: 'location',
  },
  'location.quiet_hours': {
    category: 'location',
    description:
      'Time range when the user prefers no notifications or disturbances at this location.',
    valueType: 'string',
    scope: 'location',
  },
};

// Slug format validation regex
const SLUG_REGEX = /^[a-z]+(\.[a-z0-9_]+)+$/;

/**
 * Validates that a slug matches the required format.
 * Format: category.key or category.sub_key (lowercase, dots, underscores, numbers)
 */
export function validateSlugFormat(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

/**
 * Checks if a slug exists in the catalog.
 */
export function isKnownSlug(slug: string): boolean {
  return slug in PREFERENCE_CATALOG;
}

/**
 * Gets the definition for a slug, or undefined if not found.
 */
export function getDefinition(slug: string): PreferenceDefinition | undefined {
  return PREFERENCE_CATALOG[slug];
}

/**
 * Gets all slugs in the catalog.
 */
export function getAllSlugs(): string[] {
  return Object.keys(PREFERENCE_CATALOG);
}

/**
 * Gets all slugs filtered by category.
 */
export function getSlugsByCategory(category: string): string[] {
  return Object.entries(PREFERENCE_CATALOG)
    .filter(([, def]) => def.category === category)
    .map(([slug]) => slug);
}

/**
 * Gets all unique categories in the catalog.
 */
export function getAllCategories(): string[] {
  const categories = new Set(
    Object.values(PREFERENCE_CATALOG).map((def) => def.category),
  );
  return Array.from(categories).sort();
}

/**
 * Finds slugs that are similar to the given input (for "did you mean?" suggestions).
 * Uses simple prefix and substring matching.
 */
export function findSimilarSlugs(input: string, limit = 3): string[] {
  const normalized = input.toLowerCase();
  const allSlugs = getAllSlugs();

  // Score each slug by similarity
  const scored = allSlugs.map((slug) => {
    let score = 0;

    // Exact category match
    const [category] = slug.split('.');
    if (normalized.startsWith(category)) score += 10;

    // Prefix match
    if (slug.startsWith(normalized)) score += 5;

    // Contains the input
    if (slug.includes(normalized)) score += 3;

    // Check definition description
    const def = PREFERENCE_CATALOG[slug];
    if (def.description.toLowerCase().includes(normalized)) score += 2;

    return { slug, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.slug);
}

/**
 * Validates that a value matches the expected type for a preference definition.
 */
export function validateValue(
  def: PreferenceDefinition,
  value: unknown,
): { valid: boolean; error?: string } {
  switch (def.valueType) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { valid: false, error: 'Value must be a boolean' };
      }
      break;

    case 'string':
      if (typeof value !== 'string') {
        return { valid: false, error: 'Value must be a string' };
      }
      break;

    case 'enum':
      if (typeof value !== 'string') {
        return { valid: false, error: 'Value must be a string' };
      }
      if (!def.options?.includes(value)) {
        return {
          valid: false,
          error: `Value must be one of: ${def.options?.join(', ')}`,
        };
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return { valid: false, error: 'Value must be an array' };
      }
      // Don't enforce item types in MVP
      break;

    default:
      return { valid: false, error: `Unknown value type: ${def.valueType}` };
  }

  return { valid: true };
}

/**
 * Enforces scope rules - ensures locationId matches the expected scope.
 */
export function enforceScope(
  def: PreferenceDefinition,
  locationId: string | null | undefined,
): { valid: boolean; error?: string } {
  const hasLocationId = locationId != null && locationId !== '';

  if (def.scope === 'global' && hasLocationId) {
    return {
      valid: false,
      error: `Preference "${def.category}" is global and cannot have a locationId`,
    };
  }

  if (def.scope === 'location' && !hasLocationId) {
    return {
      valid: false,
      error: `Preference "${def.category}" requires a locationId`,
    };
  }

  return { valid: true };
}

/**
 * Validates confidence value for inferred preferences.
 */
export function validateConfidence(
  confidence: number | null | undefined,
): { valid: boolean; error?: string } {
  if (confidence == null) {
    return { valid: false, error: 'Confidence is required for inferred preferences' };
  }

  if (typeof confidence !== 'number' || isNaN(confidence)) {
    return { valid: false, error: 'Confidence must be a number' };
  }

  if (confidence < 0 || confidence > 1) {
    return { valid: false, error: 'Confidence must be between 0 and 1' };
  }

  return { valid: true };
}
