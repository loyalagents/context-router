import { DynamicModule, Global, Module } from "@nestjs/common";
import type { PoolConfig } from "pg";
import { PrismaModule } from "@infrastructure/prisma/prisma.module";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import { PreferenceRepository } from "@modules/preferences/preference/preference.repository";
import { PreferenceDefinitionRepository } from "@modules/preferences/preference-definition/preference-definition.repository";
import { PreferenceAuditService } from "@modules/preferences/audit/preference-audit.service";
import { StorageUnitOfWork } from "@/domains/shared/storage/storage-unit-of-work";
import { PostgresPreferenceRepository } from "./postgres-preference.repository";
import { PostgresPreferenceDefinitionRepository } from "./postgres-preference-definition.repository";
import { PostgresPreferenceAuditService } from "./postgres-preference-audit.service";
import { PostgresStorageUnitOfWork } from "./postgres-unit-of-work";

const providers = [
  {
    provide: PreferenceRepository,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresPreferenceRepository(client),
  },
  {
    provide: PreferenceDefinitionRepository,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresPreferenceDefinitionRepository(client),
  },
  {
    provide: PreferenceAuditService,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresPreferenceAuditService(client),
  },
  {
    provide: StorageUnitOfWork,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresStorageUnitOfWork(client),
  },
];

/** Concrete storage selection occurs only in an explicit application composition root. */
@Global()
@Module({})
export class PostgresStorageModule {
  static registerHosted(): DynamicModule {
    return this.registerDriver(PrismaModule.registerHosted());
  }
  static registerLocal(configuration: PoolConfig): DynamicModule {
    return this.registerDriver(PrismaModule.registerLocal(configuration));
  }
  private static registerDriver(driver: DynamicModule): DynamicModule {
    return {
      module: PostgresStorageModule,
      global: true,
      imports: [driver],
      providers,
      exports: providers.map((provider) => provider.provide),
    };
  }
}
