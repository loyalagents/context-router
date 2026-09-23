import type { AuditEventInput } from "./audit.types";

/** Behavioral storage port; transaction-bound instances are supplied only by StorageUnitOfWork. */
export abstract class PreferenceAuditService {
  abstract record(event: AuditEventInput): Promise<void>;
}
