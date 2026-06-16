import { PreferenceValueType } from "@infrastructure/prisma/generated-client";

type PreferenceValueTypeDefinition = {
  valueType: PreferenceValueType;
  options?: unknown;
};

export type PreferenceValueNormalizationEvent = {
  kind:
    | "trimmed_string"
    | "canonicalized_enum"
    | "coerced_array_scalar"
    | "trimmed_array_entry"
    | "dropped_empty_array_entry"
    | "deduped_array_entry";
  slug?: string;
};

type CanonicalizePreferenceValueOptions = {
  slug?: string;
  onEvent?: (event: PreferenceValueNormalizationEvent) => void;
};

export function canonicalizePreferenceValue(
  definition: PreferenceValueTypeDefinition,
  value: unknown,
  options: CanonicalizePreferenceValueOptions = {},
): unknown {
  if (definition.valueType === PreferenceValueType.STRING) {
    return canonicalizeString(value, options);
  }

  if (definition.valueType === PreferenceValueType.ENUM) {
    return canonicalizeEnum(definition.options, value, options);
  }

  if (definition.valueType !== PreferenceValueType.ARRAY) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      emit(options, "coerced_array_scalar");
      return [trimmed];
    }
    return trimmed;
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const normalized: unknown[] = [];
  const seenStrings = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      normalized.push(entry);
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      emit(options, "dropped_empty_array_entry");
      continue;
    }
    if (seenStrings.has(trimmed)) {
      emit(options, "deduped_array_entry");
      continue;
    }

    if (trimmed !== entry) {
      emit(options, "trimmed_array_entry");
    }
    seenStrings.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function canonicalizeString(
  value: unknown,
  options: CanonicalizePreferenceValueOptions,
): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed !== value) {
    emit(options, "trimmed_string");
  }
  return trimmed;
}

function canonicalizeEnum(
  rawOptions: unknown,
  value: unknown,
  options: CanonicalizePreferenceValueOptions,
): unknown {
  const trimmed = canonicalizeString(value, options);
  if (typeof trimmed !== "string" || !Array.isArray(rawOptions)) {
    return trimmed;
  }

  const match = rawOptions.find(
    (option): option is string =>
      typeof option === "string" &&
      option.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  if (match && match !== trimmed) {
    emit(options, "canonicalized_enum");
    return match;
  }

  return trimmed;
}

function emit(
  options: CanonicalizePreferenceValueOptions,
  kind: PreferenceValueNormalizationEvent["kind"],
): void {
  options.onEvent?.({ kind, slug: options.slug });
}
