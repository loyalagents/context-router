import { Injectable } from "@nestjs/common";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import { StorageScopeExpiredError } from "@/domains/shared/storage/storage-errors";
import {
  StorageUnitOfWork,
  type StorageScope,
} from "@/domains/shared/storage/storage-unit-of-work";
import { PostgresPreferenceRepository } from "./postgres-preference.repository";
import { PostgresPreferenceDefinitionRepository } from "./postgres-preference-definition.repository";
import { PostgresPreferenceAuditService } from "./postgres-preference-audit.service";
import { postgresFailure } from "./postgres-client";

@Injectable()
export class PostgresStorageUnitOfWork implements StorageUnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(operation: (scope: StorageScope) => Promise<T>): Promise<T> {
    return this.execute(operation, false);
  }
  serializable<T>(operation: (scope: StorageScope) => Promise<T>): Promise<T> {
    return this.execute(operation, true);
  }

  private async execute<T>(
    operation: (scope: StorageScope) => Promise<T>,
    serializable: boolean,
  ): Promise<T> {
    let callbackFailed = false;
    let callbackFailure: unknown;
    try {
      return await this.prisma.$transaction(
        async (client) => {
          let active = true;
          const guard = <T extends object, K extends keyof T>(
            facet: T,
            methods: readonly K[],
          ): Pick<T, K> => {
            const closed = Object.create(null) as Pick<T, K>;
            for (const key of methods) {
              const method = facet[key];
              if (typeof method !== "function")
                throw new Error("Invalid storage facet");
              closed[key] = (async (...args: unknown[]) => {
                if (!active) throw new StorageScopeExpiredError();
                return method.apply(facet, args);
              }) as T[K];
            }
            return Object.freeze(closed);
          };
          const scope: StorageScope = Object.freeze({
            preferences: guard(new PostgresPreferenceRepository(client), [
              "upsertActive",
              "upsertSuggested",
              "upsertRejected",
              "delete",
            ]),
            definitions: guard(
              new PostgresPreferenceDefinitionRepository(client),
              ["create", "update", "archive"],
            ),
            audit: guard(new PostgresPreferenceAuditService(client), [
              "record",
            ]),
          });
          try {
            return await operation(scope);
          } catch (error) {
            callbackFailed = true;
            callbackFailure = error;
            throw error;
          } finally {
            active = false;
          }
        },
        serializable ? { isolationLevel: "Serializable" } : undefined,
      );
    } catch (error) {
      if (callbackFailed && Object.is(error, callbackFailure)) throw error;
      throw postgresFailure(error);
    }
  }
}
