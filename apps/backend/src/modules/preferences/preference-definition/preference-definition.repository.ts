import type {
  PreferenceDefinition as StoredPreferenceDefinition,
  PreferenceValueType,
  PreferenceScope,
} from "@/domains/shared/storage/storage-types";

/** Behavioral storage port; transaction-bound instances are supplied only by StorageUnitOfWork. */
export abstract class PreferenceDefinitionRepository {
  abstract resolveSlugToDefinitionId(
    slug: string,
    userId?: string | null,
  ): Promise<string | null>;
  abstract getDefinitionBySlug(
    slug: string,
    userId?: string | null,
  ): Promise<StoredPreferenceDefinition | null>;
  abstract getUserDefinitionBySlugIncludingArchived(
    slug: string,
    userId: string,
  ): Promise<StoredPreferenceDefinition | null>;
  abstract getDefinitionById(
    id: string,
  ): Promise<StoredPreferenceDefinition | null>;
  abstract getByScope(
    scope: "GLOBAL" | "PERSONAL" | "ALL",
    userId: string,
  ): Promise<StoredPreferenceDefinition[]>;
  abstract getAll(
    userId?: string | null,
  ): Promise<StoredPreferenceDefinition[]>;
  abstract isKnownSlug(slug: string, userId?: string | null): Promise<boolean>;
  abstract getAllSlugs(userId?: string | null): Promise<string[]>;
  abstract getSlugsByCategory(
    category: string,
    userId?: string | null,
  ): Promise<string[]>;
  abstract getAllCategories(userId?: string | null): Promise<string[]>;
  abstract findSimilarSlugs(
    input: string,
    limit?: number,
    userId?: string | null,
  ): Promise<string[]>;
  abstract create(data: {
    slug: string;
    displayName?: string;
    description: string;
    valueType: PreferenceValueType | string;
    scope: PreferenceScope | string;
    options?: unknown;
    isSensitive?: boolean;
    isCore?: boolean;
    ownerUserId?: string | null;
  }): Promise<StoredPreferenceDefinition>;
  abstract update(
    id: string,
    data: {
      displayName?: string;
      description?: string;
      valueType?: PreferenceValueType | string;
      scope?: PreferenceScope | string;
      options?: unknown;
      isSensitive?: boolean;
      isCore?: boolean;
    },
  ): Promise<StoredPreferenceDefinition>;
  abstract archive(id: string): Promise<StoredPreferenceDefinition>;
}
