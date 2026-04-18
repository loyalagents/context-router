import { PreferenceValueType } from "@infrastructure/prisma/generated-client";

type PreferenceValueTypeDefinition = {
  valueType: PreferenceValueType;
};

export function canonicalizePreferenceValue(
  definition: PreferenceValueTypeDefinition,
  value: unknown,
): unknown {
  if (
    definition.valueType !== PreferenceValueType.ARRAY ||
    !Array.isArray(value)
  ) {
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
    if (!trimmed || seenStrings.has(trimmed)) {
      continue;
    }

    seenStrings.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}
