import { PreferenceDefinitionService } from "../../src/modules/preferences/preference-definition/preference-definition.service";
import { PreferenceDefinitionRepository } from "../../src/modules/preferences/preference-definition/preference-definition.repository";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { getPrismaClient } from "../setup/test-db";
import {
  AuditActorType,
  AuditOrigin,
  PreferenceScope,
  PreferenceValueType,
} from "@infrastructure/prisma/generated-client";
import { PreferenceAuditService } from "../../src/modules/preferences/audit/preference-audit.service";

describe("PreferenceDefinitionService (integration)", () => {
  let prisma: PrismaService;
  let defRepo: PreferenceDefinitionRepository;
  let userId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    defRepo = new PreferenceDefinitionRepository(prisma);
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: "preference-definition-service@example.com",
        firstName: "Definition",
        lastName: "Service",
      },
    });
    userId = user.userId;
  });

  it("rolls back create when audit recording fails", async () => {
    const auditService = {
      record: jest.fn().mockRejectedValue(new Error("audit write failed")),
    } as unknown as PreferenceAuditService;

    const service = new PreferenceDefinitionService(defRepo, prisma, auditService);

    await expect(
      service.create(
        {
          slug: "custom.audit_rollback",
          description: "Should not persist when audit recording fails",
          valueType: PreferenceValueType.STRING,
          scope: PreferenceScope.GLOBAL,
        },
        userId,
        {
          actorType: AuditActorType.USER,
          origin: AuditOrigin.GRAPHQL,
          correlationId: "corr-def-rollback",
          sourceType: "USER" as any,
        },
      ),
    ).rejects.toThrow("audit write failed");

    expect(
      await prisma.preferenceDefinition.count({
        where: {
          ownerUserId: userId,
          slug: "custom.audit_rollback",
        },
      }),
    ).toBe(0);

    expect(
      await prisma.preferenceAuditEvent.count({
        where: { userId },
      }),
    ).toBe(0);
  });
});
