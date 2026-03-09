import {
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";

// Slug format validation regex
const SLUG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/**
 * Validates that a slug matches the required format.
 * Format: category.key or category.sub_key (lowercase, dots, underscores, numbers)
 */
export function validateSlugFormat(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

/**
 * Validates that a value matches the expected type for a preference definition.
 */
export function validateValue(
  def: { valueType: PreferenceValueType; options?: unknown },
  value: unknown,
): { valid: boolean; error?: string } {
  switch (def.valueType) {
    case PreferenceValueType.BOOLEAN:
      if (typeof value !== "boolean") {
        return { valid: false, error: "Value must be a boolean" };
      }
      break;

    case PreferenceValueType.STRING:
      if (typeof value !== "string") {
        return { valid: false, error: "Value must be a string" };
      }
      break;

    case PreferenceValueType.ENUM: {
      if (typeof value !== "string") {
        return { valid: false, error: "Value must be a string" };
      }
      const options = def.options as string[] | undefined;
      if (!options?.includes(value)) {
        return {
          valid: false,
          error: `Value must be one of: ${options?.join(", ")}`,
        };
      }
      break;
    }

    case PreferenceValueType.ARRAY:
      if (!Array.isArray(value)) {
        return { valid: false, error: "Value must be an array" };
      }
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
  def: { scope: PreferenceScope; category?: string },
  locationId: string | null | undefined,
): { valid: boolean; error?: string } {
  const hasLocationId = locationId != null && locationId !== "";

  if (def.scope === PreferenceScope.GLOBAL && hasLocationId) {
    return {
      valid: false,
      error: `Preference "${def.category}" is global and cannot have a locationId`,
    };
  }

  if (def.scope === PreferenceScope.LOCATION && !hasLocationId) {
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
export function validateConfidence(confidence: number | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (confidence == null) {
    return {
      valid: false,
      error: "Confidence is required for inferred preferences",
    };
  }

  if (typeof confidence !== "number" || isNaN(confidence)) {
    return { valid: false, error: "Confidence must be a number" };
  }

  if (confidence < 0 || confidence > 1) {
    return { valid: false, error: "Confidence must be between 0 and 1" };
  }

  return { valid: true };
}
