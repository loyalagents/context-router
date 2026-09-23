import type {
  Preference as StoredPreference,
  PreferenceStatus,
} from "@/domains/shared/storage/storage-types";
import type {
  PreferenceProvenanceOptions,
  PreferenceMutationAttribution,
  PreferenceWriteResult,
} from "../audit/audit.types";

export interface EnrichedPreference extends StoredPreference {
  slug: string;
  category: string;
  description?: string;
  lastModifiedBy: PreferenceMutationAttribution | null;
}

/** Behavioral storage port; transaction-bound instances are supplied only by StorageUnitOfWork. */
export abstract class PreferenceRepository {
  abstract upsertActive(
    userId: string,
    definitionId: string,
    value: unknown,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
    mutationAttribution?: PreferenceMutationAttribution,
  ): Promise<PreferenceWriteResult<EnrichedPreference>>;
  abstract upsertSuggested(
    userId: string,
    definitionId: string,
    value: unknown,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
    mutationAttribution?: PreferenceMutationAttribution,
  ): Promise<PreferenceWriteResult<EnrichedPreference>>;
  abstract upsertRejected(
    userId: string,
    definitionId: string,
    value: unknown,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
  ): Promise<PreferenceWriteResult<EnrichedPreference>>;
  abstract hasRejected(
    userId: string,
    definitionId: string,
    locationId?: string | null,
  ): Promise<boolean>;
  abstract findById(id: string): Promise<EnrichedPreference | null>;
  abstract findByStatus(
    userId: string,
    status: PreferenceStatus,
    locationId?: string | null,
  ): Promise<EnrichedPreference[]>;
  abstract findActiveWithMerge(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]>;
  abstract findSuggestedUnion(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]>;
  abstract delete(id: string): Promise<EnrichedPreference>;
  abstract updateStatus(
    id: string,
    status: PreferenceStatus,
  ): Promise<EnrichedPreference>;
  abstract count(userId: string, status?: PreferenceStatus): Promise<number>;
}
