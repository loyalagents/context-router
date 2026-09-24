import { DynamicModule, Global, Module } from "@nestjs/common";

import type { LocalIdentityConfiguration } from "../config/local-identity.config";
import { PostgresStorageModule } from "../infrastructure/storage/postgres/postgres-storage.module";
import { LocalIdentityFileStore } from "../modules/auth/local-identity-filesystem";

@Global()
@Module({})
export class PostgresReferenceLocalIdentityInfrastructureModule {
  static register(configuration: LocalIdentityConfiguration): DynamicModule {
    return {
      module: PostgresReferenceLocalIdentityInfrastructureModule,
      global: true,
      imports: [PostgresStorageModule.registerLocal(configuration.poolConfig)],
      providers: [
        {
          provide: LocalIdentityFileStore,
          useFactory: () =>
            new LocalIdentityFileStore({
              stateRoot: configuration.stateRoot,
              databaseTargetId: configuration.databaseTargetId,
            }),
        },
      ],
      exports: [LocalIdentityFileStore],
    };
  }
}
