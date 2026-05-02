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
export const PREFERENCE_CATALOG: Record<string, PreferenceDefinition> = {
  'profile.full_name': {
    category: 'profile',
    displayName: 'Full Name',
    description:
      "The user's preferred full name for addressing them and filling forms.",
    valueType: 'string',
    scope: 'global',
  },
  'profile.first_name': {
    category: 'profile',
    displayName: 'First Name',
    description: "The user's preferred first or given name.",
    valueType: 'string',
    scope: 'global',
  },
  'profile.last_name': {
    category: 'profile',
    displayName: 'Last Name',
    description: "The user's preferred last or family name.",
    valueType: 'string',
    scope: 'global',
  },
  'profile.email': {
    category: 'profile',
    displayName: 'Contact Email',
    description:
      "The user's preferred contact email for forms and communication.",
    valueType: 'string',
    scope: 'global',
    isSensitive: true,
  },
  'profile.badge_name': {
    category: 'profile',
    displayName: 'Badge Name',
    description:
      'The name the user prefers on badges, labels, or short-form introductions.',
    valueType: 'string',
    scope: 'global',
  },
  'profile.company': {
    category: 'profile',
    displayName: 'Company',
    description:
      "The user's current organization or company for profile and form filling.",
    valueType: 'string',
    scope: 'global',
  },
  'profile.title': {
    category: 'profile',
    displayName: 'Title',
    description:
      "The user's current role, title, or job function for profile and form filling.",
    valueType: 'string',
    scope: 'global',
  },
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
