import { DynamicModule, Global, Module } from "@nestjs/common";

import type { LocalIdentityConfiguration } from "../config/local-identity.config";
import { PrismaModule } from "../infrastructure/prisma/prisma.module";
import { LocalIdentityFileStore } from "../modules/auth/local-identity-filesystem";

@Global()
@Module({})
export class LocalIdentityInfrastructureModule {
  static register(configuration: LocalIdentityConfiguration): DynamicModule {
    return {
      module: LocalIdentityInfrastructureModule,
      global: true,
      imports: [PrismaModule.registerLocal(configuration.poolConfig)],
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
