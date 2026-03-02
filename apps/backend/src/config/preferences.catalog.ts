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
  category: string; // UI grouping only (system/food/professional/work/etc.)
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
  // ─── System ───
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

  // ─── Food ───
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

  // ─── Travel ───
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

  // ─── Communication ───
  'communication.preferred_channels': {
    category: 'communication',
    description:
      'Preferred methods of communication (e.g., email, phone, text, slack).',
    valueType: 'array',
    scope: 'global',
  },
  'communication.style': {
    category: 'communication',
    description:
      'How the user prefers to communicate — their tone, approach, and interaction style.',
    valueType: 'string',
    scope: 'global',
  },

  // ─── Location ───
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

  // ─── Profile ───
  'profile.bio': {
    category: 'profile',
    description:
      'A narrative summary of who the user is — their background, role, interests, and personality. Used by AI for personalization context.',
    valueType: 'string',
    scope: 'global',
  },

  // ─── Identity ───
  'identity.age': {
    category: 'identity',
    description: "The user's age.",
    valueType: 'string',
    scope: 'global',
  },
  'identity.date_of_birth': {
    category: 'identity',
    description: "The user's date of birth.",
    valueType: 'string',
    scope: 'global',
  },
  'identity.location': {
    category: 'identity',
    description: "The user's primary city and country of residence.",
    valueType: 'string',
    scope: 'global',
  },
  'identity.nationality': {
    category: 'identity',
    description: "The user's nationality or cultural background.",
    valueType: 'string',
    scope: 'global',
  },
  'identity.languages': {
    category: 'identity',
    description:
      'Languages the user speaks or understands, ordered by proficiency.',
    valueType: 'array',
    scope: 'global',
  },
  'identity.visa_status': {
    category: 'identity',
    description: "The user's immigration or visa status.",
    valueType: 'string',
    scope: 'global',
  },

  // ─── Professional ───
  'professional.current_role': {
    category: 'professional',
    description: "The user's current job title or professional role.",
    valueType: 'string',
    scope: 'global',
  },
  'professional.current_company': {
    category: 'professional',
    description: "The user's current employer or organization.",
    valueType: 'string',
    scope: 'global',
  },
  'professional.industry': {
    category: 'professional',
    description: 'The industry or sector the user works in.',
    valueType: 'string',
    scope: 'global',
  },
  'professional.experience_years': {
    category: 'professional',
    description: 'Years of professional experience.',
    valueType: 'string',
    scope: 'global',
  },
  'professional.education': {
    category: 'professional',
    description: "The user's educational background.",
    valueType: 'string',
    scope: 'global',
  },
  'professional.skills': {
    category: 'professional',
    description: 'Professional skills and competencies the user possesses.',
    valueType: 'array',
    scope: 'global',
  },
  'professional.expertise_areas': {
    category: 'professional',
    description:
      'Domains or subject areas where the user has deep expertise.',
    valueType: 'array',
    scope: 'global',
  },
  'professional.work_style': {
    category: 'professional',
    description:
      "How the user prefers to work — their style, habits, and approach to collaboration.",
    valueType: 'string',
    scope: 'global',
  },

  // ─── Projects ───
  'projects.current': {
    category: 'projects',
    description:
      'Current projects the user is working on (array of objects with name, description, stage).',
    valueType: 'array',
    scope: 'global',
  },
  'projects.past': {
    category: 'projects',
    description: 'Past projects or notable experiences.',
    valueType: 'array',
    scope: 'global',
  },

  // ─── Goals ───
  'goals.short_term': {
    category: 'goals',
    description:
      "The user's current short-term goals or objectives they are working toward.",
    valueType: 'array',
    scope: 'global',
  },
  'goals.long_term': {
    category: 'goals',
    description: "The user's long-term aspirations and ambitions.",
    valueType: 'array',
    scope: 'global',
  },
  'goals.career': {
    category: 'goals',
    description: "The user's overarching career goal.",
    valueType: 'string',
    scope: 'global',
  },
  'goals.personal': {
    category: 'goals',
    description: "The user's personal life goal.",
    valueType: 'string',
    scope: 'global',
  },

  // ─── Work ───
  'work.preferred_tools': {
    category: 'work',
    description:
      'Tools, instruments, or software the user prefers for their professional work. Not limited to software — can include physical tools.',
    valueType: 'array',
    scope: 'global',
  },
  'work.preferred_technologies': {
    category: 'work',
    description:
      'Technologies, platforms, or technical systems the user prefers working with.',
    valueType: 'array',
    scope: 'global',
  },
  'work.environment': {
    category: 'work',
    description:
      'The type of work environment the user thrives in (e.g., quiet office, fast-paced, remote, collaborative).',
    valueType: 'string',
    scope: 'global',
  },

  // ─── Values ───
  'values.core_beliefs': {
    category: 'values',
    description:
      'Core beliefs and guiding principles that shape the user\'s decisions.',
    valueType: 'array',
    scope: 'global',
  },
  'values.principles': {
    category: 'values',
    description:
      'Operating principles the user follows in work and life.',
    valueType: 'array',
    scope: 'global',
  },
  'values.priorities': {
    category: 'values',
    description:
      'What the user prioritizes most in their professional and personal life.',
    valueType: 'array',
    scope: 'global',
  },

  // ─── Relationships ───
  'relationships.family': {
    category: 'relationships',
    description: "The user's family situation and context.",
    valueType: 'string',
    scope: 'global',
  },
  'relationships.professional_network': {
    category: 'relationships',
    description: 'Key professional connections and communities.',
    valueType: 'array',
    scope: 'global',
  },
  'relationships.mentors': {
    category: 'relationships',
    description: 'Mentors and advisors the user looks up to.',
    valueType: 'array',
    scope: 'global',
  },

  // ─── Concerns ───
  'concerns.current': {
    category: 'concerns',
    description: 'Current worries, challenges, or things on the user\'s mind.',
    valueType: 'array',
    scope: 'global',
  },
  'concerns.recurring': {
    category: 'concerns',
    description: 'Recurring themes of concern or ongoing challenges.',
    valueType: 'array',
    scope: 'global',
  },
};
