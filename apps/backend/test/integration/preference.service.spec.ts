import { PreferenceService } from "../../src/modules/preferences/preference/preference.service";
import { PreferenceRepository } from "../../src/modules/preferences/preference/preference.repository";
import { PreferenceDefinitionRepository } from "../../src/modules/preferences/preference-definition/preference-definition.repository";
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
    prefRepo = new PreferenceRepository(prisma, defRepo);
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: "preference-service@example.com",
        firstName: "Preference",
        lastName: "Service",
      },
    });
    userId = user.userId;
  });

  it("rolls back setPreference when audit recording fails", async () => {
    const auditService = {
      record: jest.fn().mockRejectedValue(new Error("audit write failed")),
    } as unknown as PreferenceAuditService;

    const service = new PreferenceService(
      prefRepo,
      { findOne: jest.fn() } as any,
      defRepo,
      prisma,
      auditService,
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
