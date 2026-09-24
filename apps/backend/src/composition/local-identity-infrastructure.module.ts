import { DynamicModule, Global, Module } from "@nestjs/common";
import type { LocalDatabaseConfiguration } from "../config/local-database.config";
import { SqliteStorageModule } from "../infrastructure/storage/sqlite/sqlite-storage.module";
import { SqliteDatabase } from "../infrastructure/storage/sqlite/sqlite-database";
import { LocalIdentityFileStore } from "../modules/auth/local-identity-filesystem";

@Global()
@Module({})
export class LocalIdentityInfrastructureModule {
  static register(configuration: LocalDatabaseConfiguration): DynamicModule {
    return {
      module: LocalIdentityInfrastructureModule,
      global: true,
      imports: [
        SqliteStorageModule.register({
          databaseRoot: configuration.databaseRoot,
          identityRoot: configuration.stateRoot,
        }),
      ],
      providers: [
        {
          provide: LocalIdentityFileStore,
          inject: [SqliteDatabase],
          useFactory: (database: SqliteDatabase) =>
            new LocalIdentityFileStore({
              stateRoot: configuration.stateRoot,
              databaseTargetId: database.targetId,
            }),
        },
      ],
      exports: [LocalIdentityFileStore],
    };
  }
}
