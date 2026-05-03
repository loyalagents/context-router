import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
} from "@infrastructure/prisma/generated-client";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import {
  buildPreferenceAuditSnapshot,
  buildPreferenceDefinitionAuditSnapshot,
} from "../../src/modules/preferences/audit/snapshot-builders";
import { PreferenceAuditService } from "../../src/modules/preferences/audit/preference-audit.service";
import { getPrismaClient } from "../setup/test-db";

describe("PreferenceAuditService (integration)", () => {
  let prisma: PrismaService;
  let auditService: PreferenceAuditService;
  let testUserId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    auditService = new PreferenceAuditService(prisma);
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: "audit-test@example.com",
      },
    });

    testUserId = user.userId;
  });

  it("exposes the expected audit enums", () => {
    expect(AuditTargetType).toMatchObject({
      PREFERENCE: "PREFERENCE",
      PREFERENCE_DEFINITION: "PREFERENCE_DEFINITION",
    });

    expect(AuditActorType).toMatchObject({
      USER: "USER",
      MCP_CLIENT: "MCP_CLIENT",
      SYSTEM: "SYSTEM",
      WORKFLOW: "WORKFLOW",
      IMPORT: "IMPORT",
    });

    expect(AuditOrigin).toMatchObject({
      GRAPHQL: "GRAPHQL",
      MCP: "MCP",
      DOCUMENT_ANALYSIS: "DOCUMENT_ANALYSIS",
      WORKFLOW: "WORKFLOW",
      SYSTEM: "SYSTEM",
    });

    expect(AuditEventType).toMatchObject({
      PREFERENCES_RESET: "PREFERENCES_RESET",
      PREFERENCE_SET: "PREFERENCE_SET",
      PREFERENCE_SUGGESTED_UPSERTED: "PREFERENCE_SUGGESTED_UPSERTED",
      PREFERENCE_SUGGESTION_ACCEPTED: "PREFERENCE_SUGGESTION_ACCEPTED",
      PREFERENCE_SUGGESTION_REJECTED: "PREFERENCE_SUGGESTION_REJECTED",
      PREFERENCE_DELETED: "PREFERENCE_DELETED",
      DEFINITION_CREATED: "DEFINITION_CREATED",
      DEFINITION_UPDATED: "DEFINITION_UPDATED",
      DEFINITION_ARCHIVED: "DEFINITION_ARCHIVED",
    });
  });

  it("records an audit row with actor metadata, origin, correlation id, and snapshots", async () => {
    const correlationId = "corr-preference-set";
    const beforeState = {
      id: "pref-1",
      status: "SUGGESTED",
      value: "casual",
    };
    const afterState = {
      id: "pref-1",
      status: "ACTIVE",
      value: "professional",
    };
    const metadata = {
      reason: "manual edit",
      requestId: "req-123",
    };

    await auditService.record({
      userId: testUserId,
      subjectSlug: "system.response_tone",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-1",
      eventType: AuditEventType.PREFERENCE_SET,
      actorType: AuditActorType.USER,
      origin: AuditOrigin.GRAPHQL,
      correlationId,
      beforeState,
      afterState,
      metadata,
    });

    const stored = await prisma.preferenceAuditEvent.findMany({
      where: { userId: testUserId },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      userId: testUserId,
      subjectSlug: "system.response_tone",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-1",
      eventType: AuditEventType.PREFERENCE_SET,
      actorType: AuditActorType.USER,
      actorClientKey: null,
      origin: AuditOrigin.GRAPHQL,
      correlationId,
      beforeState,
      afterState,
      metadata,
    });
    expect(stored[0].id).toBeDefined();
    expect(stored[0].occurredAt).toBeInstanceOf(Date);
  });

  it("supports the intended audit query patterns", async () => {
    await auditService.record({
      userId: testUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-a",
      eventType: AuditEventType.PREFERENCE_SET,
      actorType: AuditActorType.USER,
      origin: AuditOrigin.GRAPHQL,
      correlationId: "corr-shared",
      afterState: { id: "pref-a", status: "ACTIVE" },
    });

    await auditService.record({
      userId: testUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-a",
      eventType: AuditEventType.PREFERENCE_DELETED,
      actorType: AuditActorType.MCP_CLIENT,
      actorClientKey: "codex",
      origin: AuditOrigin.MCP,
      correlationId: "corr-delete",
      beforeState: { id: "pref-a", status: "ACTIVE" },
    });

    await auditService.record({
      userId: testUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE_DEFINITION,
      targetId: "def-a",
      eventType: AuditEventType.DEFINITION_CREATED,
      actorType: AuditActorType.USER,
      origin: AuditOrigin.GRAPHQL,
      correlationId: "corr-shared",
      afterState: { id: "def-a", slug: "custom.preference" },
    });

    const byUserAndEvent = await prisma.preferenceAuditEvent.findMany({
      where: {
        userId: testUserId,
        eventType: AuditEventType.PREFERENCE_DELETED,
      },
      orderBy: { occurredAt: "desc" },
    });

    const byTarget = await prisma.preferenceAuditEvent.findMany({
      where: {
        targetType: AuditTargetType.PREFERENCE,
        targetId: "pref-a",
      },
      orderBy: { occurredAt: "desc" },
    });

    const byCorrelation = await prisma.preferenceAuditEvent.findMany({
      where: { correlationId: "corr-shared" },
      orderBy: { occurredAt: "desc" },
    });

    const bySubjectSlug = await prisma.preferenceAuditEvent.findMany({
      where: {
        userId: testUserId,
        subjectSlug: "food.dietary_restrictions",
      },
      orderBy: { occurredAt: "desc" },
    });

    expect(byUserAndEvent).toHaveLength(1);
    expect(byUserAndEvent[0]).toMatchObject({
      eventType: AuditEventType.PREFERENCE_DELETED,
      actorType: AuditActorType.MCP_CLIENT,
      actorClientKey: "codex",
      origin: AuditOrigin.MCP,
    });

    expect(byTarget).toHaveLength(2);
    expect(byTarget.map((event) => event.eventType)).toEqual([
      AuditEventType.PREFERENCE_DELETED,
      AuditEventType.PREFERENCE_SET,
    ]);

    expect(byCorrelation).toHaveLength(2);
    expect(byCorrelation.map((event) => event.targetType).sort()).toEqual([
      AuditTargetType.PREFERENCE,
      AuditTargetType.PREFERENCE_DEFINITION,
    ]);

    expect(bySubjectSlug).toHaveLength(3);
    expect(bySubjectSlug.map((event) => event.eventType).sort()).toEqual([
      AuditEventType.DEFINITION_CREATED,
      AuditEventType.PREFERENCE_DELETED,
      AuditEventType.PREFERENCE_SET,
    ]);
  });

  it("throws immediately when subjectSlug is missing", async () => {
    await expect(
      auditService.record({
        userId: testUserId,
        subjectSlug: "",
        targetType: AuditTargetType.PREFERENCE,
        targetId: "pref-1",
        eventType: AuditEventType.PREFERENCE_SET,
        actorType: AuditActorType.USER,
        origin: AuditOrigin.GRAPHQL,
        correlationId: "corr-missing-slug",
      }),
    ).rejects.toThrow("Audit event subjectSlug is required");
  });

  it("trims subjectSlug before persisting the audit row", async () => {
    await auditService.record({
      userId: testUserId,
      subjectSlug: "  system.response_tone  ",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-trimmed",
      eventType: AuditEventType.PREFERENCE_SET,
      actorType: AuditActorType.USER,
      origin: AuditOrigin.GRAPHQL,
      correlationId: "corr-trimmed-slug",
      afterState: { id: "pref-trimmed", status: "ACTIVE" },
    });

    const stored = await prisma.preferenceAuditEvent.findFirstOrThrow({
      where: { userId: testUserId, targetId: "pref-trimmed" },
    });

    expect(stored.subjectSlug).toBe("system.response_tone");
  });

  it("builds normalized preference and definition snapshots", () => {
    const preferenceSnapshot = buildPreferenceAuditSnapshot({
      id: "pref-123",
      userId: "user-123",
      definitionId: "def-123",
      slug: "food.dietary_restrictions",
      contextKey: "GLOBAL",
      locationId: null,
      value: ["peanuts"],
      status: "ACTIVE",
      sourceType: "INFERRED",
      confidence: 0.91,
      evidence: { snippets: ["peanut allergy"] },
      lastModifiedBy: {
        actorType: "MCP_CLIENT",
        actorClientKey: "codex",
        origin: "MCP",
      },
      createdAt: new Date("2026-04-18T01:00:00.000Z"),
      updatedAt: new Date("2026-04-18T02:00:00.000Z"),
      category: "food",
      description: "Dietary restrictions",
    });

    const definitionSnapshot = buildPreferenceDefinitionAuditSnapshot({
      id: "def-123",
      namespace: "USER:user-123",
      slug: "food.dietary_restrictions",
      displayName: "Dietary Restrictions",
      description: "Foods to avoid",
      valueType: "ARRAY",
      scope: "GLOBAL",
      options: null,
      isSensitive: true,
      isCore: false,
      archivedAt: null,
      ownerUserId: "user-123",
      createdAt: new Date("2026-04-18T01:00:00.000Z"),
      updatedAt: new Date("2026-04-18T02:00:00.000Z"),
    });

    expect(preferenceSnapshot).toEqual({
      id: "pref-123",
      userId: "user-123",
      definitionId: "def-123",
      slug: "food.dietary_restrictions",
      contextKey: "GLOBAL",
      locationId: null,
      value: ["peanuts"],
      status: "ACTIVE",
      sourceType: "INFERRED",
      confidence: 0.91,
      evidence: { snippets: ["peanut allergy"] },
      lastModifiedBy: {
        actorType: "MCP_CLIENT",
        actorClientKey: "codex",
        origin: "MCP",
      },
      createdAt: "2026-04-18T01:00:00.000Z",
      updatedAt: "2026-04-18T02:00:00.000Z",
    });

    expect(definitionSnapshot).toEqual({
      id: "def-123",
      namespace: "USER:user-123",
      slug: "food.dietary_restrictions",
      displayName: "Dietary Restrictions",
      description: "Foods to avoid",
      valueType: "ARRAY",
      scope: "GLOBAL",
      options: null,
      isSensitive: true,
      isCore: false,
      archivedAt: null,
      ownerUserId: "user-123",
      createdAt: "2026-04-18T01:00:00.000Z",
      updatedAt: "2026-04-18T02:00:00.000Z",
    });
  });
});
