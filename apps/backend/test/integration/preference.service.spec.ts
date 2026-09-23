import { PostgresStorageUnitOfWork } from '@/infrastructure/storage/postgres/postgres-unit-of-work';
import { PreferenceService } from "../../src/modules/preferences/preference/preference.service";
import { PostgresPreferenceRepository as PreferenceRepository } from '@/infrastructure/storage/postgres/postgres-preference.repository';
import { PostgresPreferenceDefinitionRepository as PreferenceDefinitionRepository } from '@/infrastructure/storage/postgres/postgres-preference-definition.repository';
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { getPrismaClient } from "../setup/test-db";
import {
  AuditActorType,
  AuditOrigin,
  SourceType,
} from "@infrastructure/prisma/generated-client";
import { PreferenceAuditService } from "../../src/modules/preferences/audit/preference-audit.service";

describe("PreferenceService (integration)", () => {
  let prisma: PrismaService;
  let defRepo: PreferenceDefinitionRepository;
  let prefRepo: PreferenceRepository;
  let userId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    defRepo = new PreferenceDefinitionRepository(prisma);
    prefRepo = new PreferenceRepository(prisma);
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: "preference-service@example.com",
      },
    });
    userId = user.userId;
  });

  it("rolls back setPreference when audit recording fails", async () => {
    const auditService = {
      record: jest.fn().mockRejectedValue(new Error("audit write failed")),
    } as unknown as PreferenceAuditService;

    const realUnit = new PostgresStorageUnitOfWork(prisma);
    const unit = {
      run: <T>(operation: Parameters<typeof realUnit.run<T>>[0]) => realUnit.run((scope) => operation({ ...scope, audit: auditService })),
      serializable: realUnit.serializable.bind(realUnit),
    };
    const service = new PreferenceService(
      prefRepo,
      { findOne: jest.fn() } as any,
      defRepo,
      unit,
    );

    await expect(
      service.setPreference(
        userId,
        {
          slug: "system.response_tone",
          value: "casual",
        },
        {
          actorType: AuditActorType.USER,
          origin: AuditOrigin.GRAPHQL,
          correlationId: "corr-pref-rollback",
          sourceType: SourceType.USER,
        },
      ),
    ).rejects.toThrow("audit write failed");

    expect(
      await prisma.preference.count({
        where: { userId },
      }),
    ).toBe(0);

    expect(
      await prisma.preferenceAuditEvent.count({
        where: { userId },
      }),
    ).toBe(0);
  });
});
