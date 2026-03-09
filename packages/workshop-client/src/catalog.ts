import {
  WorkshopCatalogEntry,
  WorkshopClientError,
  type WorkshopValueType,
} from "./types";

interface ExportedPreferenceDefinition {
  slug: string;
  displayName?: string | null;
  ownerUserId?: string | null;
  description: string;
  valueType: WorkshopValueType;
  scope: "GLOBAL" | "LOCATION";
  options?: unknown;
}

export function mapCatalogEntries(
  definitions: ExportedPreferenceDefinition[],
): WorkshopCatalogEntry[] {
  return definitions
    .filter((definition) => definition.scope === "GLOBAL")
    .map((definition) => ({
      slug: definition.slug,
      displayName: definition.displayName ?? undefined,
      description: definition.description,
      valueType: definition.valueType,
      options: normalizeOptions(definition.options),
      origin: definition.ownerUserId ? "personal" : "system",
    }));
}

export function validatePreferenceValue(
  catalog: readonly WorkshopCatalogEntry[],
  input: { slug: string; value: unknown },
): WorkshopCatalogEntry {
  const entry = catalog.find((candidate) => candidate.slug === input.slug);
  if (!entry) {
    throw new WorkshopClientError({
      kind: "config",
      message: `Unknown preference slug: "${input.slug}"`,
      operation: "setPreference",
    });
  }

  switch (entry.valueType) {
    case "STRING":
      if (typeof input.value !== "string") {
        throw invalidValue(entry.slug, "expected a string");
      }
      return entry;
    case "BOOLEAN":
      if (typeof input.value !== "boolean") {
        throw invalidValue(entry.slug, "expected a boolean");
      }
      return entry;
    case "ARRAY":
      if (!Array.isArray(input.value)) {
        throw invalidValue(entry.slug, "expected an array");
      }
      return entry;
    case "ENUM":
      if (typeof input.value !== "string") {
        throw invalidValue(entry.slug, "expected a string enum option");
      }
      if (!entry.options || !entry.options.includes(input.value)) {
        throw invalidValue(
          entry.slug,
          `expected one of: ${(entry.options ?? []).join(", ")}`,
        );
      }
      return entry;
    default:
      return entry;
  }
}

export function exampleValueForCatalogEntry(entry: WorkshopCatalogEntry): unknown {
  switch (entry.valueType) {
    case "BOOLEAN":
      return true;
    case "ARRAY":
      return ["workshop-smoke"];
    case "ENUM":
      return entry.options?.[0] ?? "example";
    case "STRING":
    default:
      return "workshop-smoke";
  }
}

function invalidValue(slug: string, reason: string): WorkshopClientError {
  return new WorkshopClientError({
    kind: "config",
    message: `Invalid value for "${slug}": ${reason}`,
    operation: "setPreference",
  });
}

function normalizeOptions(options: unknown): readonly string[] | undefined {
  if (!Array.isArray(options)) {
    return undefined;
  }
  const normalized = options.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return normalized.length > 0 ? normalized : undefined;
}
