import { UserRepository } from "@/modules/user/user.repository";
import { PostgresUserRepository } from "./postgres-user.repository";
import { ExternalIdentityRepository } from "@/modules/external-identity/external-identity.repository";
import { PostgresExternalIdentityRepository } from "./postgres-external-identity.repository";
import { PermissionGrantRepository } from "@/modules/permission-grant/permission-grant.repository";
import { PostgresPermissionGrantRepository } from "./postgres-permission-grant.repository";
import { LocationRepository } from "@/modules/preferences/location/location.repository";
import { PostgresLocationRepository } from "./postgres-location.repository";
import { IdentityStorage } from "@/domains/shared/storage/identity-storage";
import { PostgresIdentityStorage } from "./postgres-identity-storage";
import { AuditHistoryStorage } from "@/domains/shared/storage/history-storage";
import { PostgresAuditHistoryStorage } from "./postgres-audit-history-storage";
import { AccessHistoryStorage } from "@/domains/shared/storage/history-storage";
import { PostgresAccessHistoryStorage } from "./postgres-access-history-storage";
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
    provide: UserRepository,
    inject: [PrismaService],
    useFactory: (client: PrismaService) => new PostgresUserRepository(client),
  },
  {
    provide: ExternalIdentityRepository,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresExternalIdentityRepository(client),
  },
  {
    provide: PermissionGrantRepository,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresPermissionGrantRepository(client),
  },
  {
    provide: LocationRepository,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresLocationRepository(client),
  },
  {
    provide: IdentityStorage,
    inject: [PrismaService],
    useFactory: (client: PrismaService) => new PostgresIdentityStorage(client),
  },
  {
    provide: AuditHistoryStorage,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresAuditHistoryStorage(client),
  },
  {
    provide: AccessHistoryStorage,
    inject: [PrismaService],
    useFactory: (client: PrismaService) =>
      new PostgresAccessHistoryStorage(client),
  },
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
