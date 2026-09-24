import { setImmediate } from "node:timers/promises";
import type {
  StorageUnitOfWork,
  StorageScope,
} from "../../../domains/shared/storage/storage-unit-of-work";
import {
  StorageScopeExpiredError,
  StorageConflictError,
  StorageUnavailableError,
} from "../../../domains/shared/storage/storage-errors";
import { SqliteDatabase, sqliteFailure } from "./sqlite-database";
import { SqliteIdentityStorage } from "./sqlite-identity-storage";
import { SqlitePreferenceRepository } from "./sqlite-preference.repository";
import { SqlitePreferenceDefinitionRepository } from "./sqlite-preference-definition.repository";
import { SqlitePreferenceAuditService } from "./sqlite-preference-audit.service";
import { SqliteResetStorage } from "./sqlite-reset-storage";

export class SqliteStorageUnitOfWork implements StorageUnitOfWork {
  constructor(private readonly database: SqliteDatabase) {}
  run<T>(operation: (scope: StorageScope) => Promise<T>): Promise<T> {
    return this.execute(operation);
  }
  serializable<T>(operation: (scope: StorageScope) => Promise<T>): Promise<T> {
    return this.execute(operation);
  }
  private async execute<T>(
    operation: (scope: StorageScope) => Promise<T>,
  ): Promise<T> {
    // One scheduling yield, then one native attempt. Application code owns every retry.
    await setImmediate();
    const connection = this.database.connect();
    let active = true,
      callbackFailed = false,
      callbackFailure: unknown;
    const guard = <T extends object, K extends keyof T>(
      facet: T,
      methods: readonly K[],
    ): Pick<T, K> => {
      const result = Object.create(null) as Pick<T, K>;
      for (const key of methods) {
        const method = facet[key];
        if (typeof method !== "function") throw new StorageUnavailableError();
        result[key] = (async (...args: unknown[]) => {
          if (!active) throw new StorageScopeExpiredError();
          connection.assertTransactionHealthy();
          return method.apply(facet, args);
        }) as T[K];
      }
      return Object.freeze(result);
    };
    try {
      await connection.exec("BEGIN IMMEDIATE");
      const scope: StorageScope = Object.freeze({
        identity: guard(new SqliteIdentityStorage(connection), [
          "findExact",
          "createPrincipal",
          "createVerifiedBinding",
          "upsertM2MPrincipal",
          "countBindings",
        ]),
        preferences: guard(new SqlitePreferenceRepository(connection), [
          "upsertActive",
          "upsertSuggested",
          "upsertRejected",
          "delete",
        ]),
        definitions: guard(
          new SqlitePreferenceDefinitionRepository(connection),
          ["create", "update", "archive"],
        ),
        audit: guard(new SqlitePreferenceAuditService(connection), ["record"]),
        reset: guard(new SqliteResetStorage(connection), [
          "deletePreferences",
          "appendMemoryResetAudit",
          "deleteAuditEvents",
          "deleteAccessEvents",
          "findOwnedDefinitionIds",
          "hasForeignDefinitionReference",
          "deleteDefinitions",
          "deleteLocations",
          "deleteGrants",
        ]),
      });
      let result: T;
      try {
        result = await operation(scope);
      } catch (error) {
        callbackFailed = true;
        callbackFailure = error;
        throw error;
      } finally {
        active = false;
      }
      connection.assertTransactionHealthy();
      await connection.exec("COMMIT");
      return result;
    } catch (error) {
      active = false;
      try {
        if (connection.inTransaction) await connection.exec("ROLLBACK");
      } catch {
        throw new StorageUnavailableError();
      }
      if (callbackFailed && Object.is(error, callbackFailure)) throw error;
      if (
        error instanceof StorageConflictError ||
        error instanceof StorageUnavailableError
      )
        throw error;
      throw sqliteFailure(error);
    } finally {
      active = false;
      connection.close();
    }
  }
}
