import type { IdentityTransaction } from "./identity-storage";
import type { ResetStorage } from "./reset-storage";
import type { PreferenceRepository } from "@modules/preferences/preference/preference.repository";
import type { PreferenceDefinitionRepository } from "@modules/preferences/preference-definition/preference-definition.repository";
import type { PreferenceAuditService } from "@modules/preferences/audit/preference-audit.service";

/** All methods belong to one transaction. Await each operation; never retain a facet past the callback. */
export interface StorageScope {
  readonly identity: IdentityTransaction;
  readonly reset: ResetStorage;
  readonly preferences: Pick<
    PreferenceRepository,
    "upsertActive" | "upsertSuggested" | "upsertRejected" | "delete"
  >;
  readonly definitions: Pick<
    PreferenceDefinitionRepository,
    "create" | "update" | "archive"
  >;
  readonly audit: PreferenceAuditService;
}

export abstract class StorageUnitOfWork {
  /** Current default isolation, one attempt; use-case validation stays outside this callback. */
  abstract run<T>(operation: (scope: StorageScope) => Promise<T>): Promise<T>;
  /** One serializable attempt; identity use cases own their existing bounded retry policy. */
  abstract serializable<T>(
    operation: (scope: StorageScope) => Promise<T>,
  ): Promise<T>;
}
