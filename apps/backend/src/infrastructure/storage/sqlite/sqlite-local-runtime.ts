import type { LocalDatabaseConfiguration } from "../../../config/local-database.config";
import { seedCatalog } from "../../../domains/shared/storage/seed-catalog";
import { LocalIdentityFileStore } from "../../../modules/auth/local-identity-filesystem";
import { LocalIdentityStateService } from "../../../modules/auth/local-identity-state.service";
import { SqliteDatabase } from "./sqlite-database";
import { SqliteCatalogStorage } from "./sqlite-catalog-storage";
import { SqliteLocalIdentityCoordination } from "./sqlite-local-identity-coordination";

export function createSqliteIdentityRuntime(
  configuration: LocalDatabaseConfiguration,
  initialize = false,
) {
  const paths = {
    databaseRoot: configuration.databaseRoot,
    identityRoot: configuration.stateRoot,
  };
  const database = initialize
    ? SqliteDatabase.bootstrap(paths)
    : SqliteDatabase.open(paths);
  const fileStore = new LocalIdentityFileStore({
    stateRoot: configuration.stateRoot,
    databaseTargetId: database.targetId,
  });
  const service = new LocalIdentityStateService({
    fileStore,
    repository: new SqliteLocalIdentityCoordination({ database }),
  });
  return { database, fileStore, service };
}
const quietCatalogLog = Object.freeze({
  log: (_message: string) => undefined,
  warn: (_message: string) => undefined,
});
export function seedLocalCatalog(database: SqliteDatabase): Promise<void> {
  return seedCatalog(
    new SqliteCatalogStorage(database),
    undefined,
    quietCatalogLog,
  );
}
