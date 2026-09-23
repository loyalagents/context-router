/** Fixed, provider-neutral classifications. Driver messages and causes stay inside the adapter. */
export class StorageConflictError extends Error {
  constructor(readonly kind: "unique" | "serialization") {
    super(`Storage ${kind} conflict`);
    this.name = "StorageConflictError";
  }
}
export class StorageUnavailableError extends Error {
  constructor() {
    super("Storage operation failed");
    this.name = "StorageUnavailableError";
  }
}
export class StorageScopeExpiredError extends Error {
  constructor() {
    super("Storage transaction scope has expired");
    this.name = "StorageScopeExpiredError";
  }
}
