import { Test } from "@nestjs/testing";
import { StorageUnitOfWork } from "../../src/domains/shared/storage/storage-unit-of-work";
import { PreferenceAuditService } from "../../src/modules/preferences/audit/preference-audit.service";
import { PostgresStorageModule } from "../../src/infrastructure/storage/postgres/postgres-storage.module";
import {
  PrismaService,
  PRISMA_SERVICE_CONFIGURATION,
} from "../../src/infrastructure/prisma/prisma.service";

describe("audit transaction composition", () => {
  it.each([
    ["hosted", () => PostgresStorageModule.registerHosted()],
    ["local", () => PostgresStorageModule.registerLocal({})],
  ] as const)(
    "provides the unit of work without a root audit binding in %s",
    async (_mode, root) => {
      const application = await Test.createTestingModule({ imports: [root()] })
        .overrideProvider(PrismaService)
        .useValue({})
        // This assembly check never creates a database client or evaluates runtime credentials.
        .overrideProvider(PRISMA_SERVICE_CONFIGURATION)
        .useValue({})
        .compile();
      try {
        expect(application.get(StorageUnitOfWork).run).toEqual(
          expect.any(Function),
        );
        expect(() => application.get(PreferenceAuditService)).toThrow();
      } finally {
        await application.close();
      }
    },
  );
});
