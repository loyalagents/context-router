import { UserRepository } from "@/modules/user/user.repository";
import { SqliteUserRepository } from "./sqlite-user.repository";
import { ExternalIdentityRepository } from "@/modules/external-identity/external-identity.repository";
import { SqliteExternalIdentityRepository } from "./sqlite-external-identity.repository";
import { PermissionGrantRepository } from "@/modules/permission-grant/permission-grant.repository";
import { SqlitePermissionGrantRepository } from "./sqlite-permission-grant.repository";
import { LocationRepository } from "@/modules/preferences/location/location.repository";
import { SqliteLocationRepository } from "./sqlite-location.repository";
import { IdentityStorage } from "@/domains/shared/storage/identity-storage";
import { SqliteIdentityStorage } from "./sqlite-identity-storage";
import { AuditHistoryStorage } from "@/domains/shared/storage/history-storage";
import { SqliteAuditHistoryStorage } from "./sqlite-audit-history-storage";
import { AccessHistoryStorage } from "@/domains/shared/storage/history-storage";
import { SqliteAccessHistoryStorage } from "./sqlite-access-history-storage";
import { DynamicModule, Global, Module } from "@nestjs/common";
import type { LocalDatabasePaths } from "./sqlite-files";
import { SqliteDatabase } from "./sqlite-database";
import { PreferenceRepository } from "@modules/preferences/preference/preference.repository";
import { PreferenceDefinitionRepository } from "@modules/preferences/preference-definition/preference-definition.repository";
import { StorageUnitOfWork } from "@/domains/shared/storage/storage-unit-of-work";
import { SqlitePreferenceRepository } from "./sqlite-preference.repository";
import { SqlitePreferenceDefinitionRepository } from "./sqlite-preference-definition.repository";
import { SqliteStorageUnitOfWork } from "./sqlite-unit-of-work";

const providers = [
  {
    provide: UserRepository,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqliteUserRepository(database),
  },
  {
    provide: ExternalIdentityRepository,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqliteExternalIdentityRepository(database),
  },
  {
    provide: PermissionGrantRepository,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqlitePermissionGrantRepository(database),
  },
  {
    provide: LocationRepository,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqliteLocationRepository(database),
  },
  {
    provide: IdentityStorage,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqliteIdentityStorage(database),
  },
  {
    provide: AuditHistoryStorage,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqliteAuditHistoryStorage(database),
  },
  {
    provide: AccessHistoryStorage,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqliteAccessHistoryStorage(database),
  },
  {
    provide: PreferenceRepository,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqlitePreferenceRepository(database),
  },
  {
    provide: PreferenceDefinitionRepository,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqlitePreferenceDefinitionRepository(database),
  },
  {
    provide: StorageUnitOfWork,
    inject: [SqliteDatabase],
    useFactory: (database: SqliteDatabase) =>
      new SqliteStorageUnitOfWork(database),
  },
];

/** Concrete storage selection occurs only in an explicit application composition root. */
@Global()
@Module({})
export class SqliteStorageModule {
  static register(paths: LocalDatabasePaths): DynamicModule {
    return {
      module: SqliteStorageModule,
      global: true,
      providers: [
        {
          provide: SqliteDatabase,
          useFactory: () => SqliteDatabase.open(paths),
        },
        ...providers,
      ],
      exports: [
        SqliteDatabase,
        ...providers.map((provider) => provider.provide),
      ],
    };
  }
}
