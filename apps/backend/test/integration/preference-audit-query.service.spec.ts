import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
} from "@infrastructure/prisma/generated-client";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { PreferenceAuditQueryService } from "../../src/modules/preferences/audit/preference-audit-query.service";
import { getPrismaClient } from "../setup/test-db";

describe("PreferenceAuditQueryService (integration)", () => {
  let prisma: PrismaService;
  let queryService: PreferenceAuditQueryService;
  let primaryUserId: string;
  let secondaryUserId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    queryService = new PreferenceAuditQueryService(prisma);
  });

  beforeEach(async () => {
    const [primaryUser, secondaryUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: "audit-query-primary@example.com",
          firstName: "Primary",
          lastName: "User",
        },
      }),
      prisma.user.create({
        data: {
          email: "audit-query-secondary@example.com",
          firstName: "Secondary",
          lastName: "User",
        },
      }),
    ]);

    primaryUserId = primaryUser.userId;
    secondaryUserId = secondaryUser.userId;
  });

  async function createAuditEvent(params: {
    id: string;
    userId: string;
    subjectSlug: string;
    targetType: AuditTargetType;
    targetId: string;
    eventType: AuditEventType;
    actorType?: AuditActorType;
    actorClientKey?: string | null;
    origin?: AuditOrigin;
    correlationId?: string;
    occurredAt: Date;
  }) {
    return prisma.preferenceAuditEvent.create({
      data: {
        id: params.id,
        userId: params.userId,
        subjectSlug: params.subjectSlug,
        targetType: params.targetType,
        targetId: params.targetId,
        eventType: params.eventType,
        actorType: params.actorType ?? AuditActorType.USER,
        actorClientKey: params.actorClientKey ?? null,
        origin: params.origin ?? AuditOrigin.GRAPHQL,
        correlationId: params.correlationId ?? `corr-${params.id}`,
        occurredAt: params.occurredAt,
      },
    });
  }

  it("returns newest-first ordering using occurredAt desc and id desc", async () => {
    const sharedTime = new Date("2026-04-18T10:00:00.000Z");

    await createAuditEvent({
      id: "audit-a",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-a",
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: sharedTime,
    });
    await createAuditEvent({
      id: "audit-b",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-b",
      eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
      occurredAt: sharedTime,
    });
    await createAuditEvent({
      id: "audit-c",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE_DEFINITION,
      targetId: "def-c",
      eventType: AuditEventType.DEFINITION_CREATED,
      occurredAt: new Date("2026-04-18T11:00:00.000Z"),
    });

    const page = await queryService.getHistory(primaryUserId, {});

    expect(page.items.map((item) => item.id)).toEqual([
      "audit-c",
      "audit-b",
      "audit-a",
    ]);
    expect(page.hasNextPage).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("returns a stable next page with cursor pagination", async () => {
    const sharedTime = new Date("2026-04-18T10:00:00.000Z");

    await createAuditEvent({
      id: "audit-a",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-a",
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: sharedTime,
    });
    await createAuditEvent({
      id: "audit-b",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-b",
      eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
      occurredAt: sharedTime,
    });
    await createAuditEvent({
      id: "audit-c",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE_DEFINITION,
      targetId: "def-c",
      eventType: AuditEventType.DEFINITION_CREATED,
      occurredAt: new Date("2026-04-18T11:00:00.000Z"),
    });

    const firstPage = await queryService.getHistory(primaryUserId, { first: 2 });

    expect(firstPage.items.map((item) => item.id)).toEqual(["audit-c", "audit-b"]);
    expect(firstPage.hasNextPage).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await queryService.getHistory(primaryUserId, {
      first: 2,
      after: firstPage.nextCursor!,
    });

    expect(secondPage.items.map((item) => item.id)).toEqual(["audit-a"]);
    expect(secondPage.hasNextPage).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("returns an empty page when no events match", async () => {
    const page = await queryService.getHistory(primaryUserId, {
      subjectSlug: "missing.slug",
    });

    expect(page).toEqual({
      items: [],
      hasNextPage: false,
      nextCursor: null,
    });
  });

  it("rejects malformed cursors with a BadRequestException", async () => {
    await expect(
      queryService.getHistory(primaryUserId, {
        after: "definitely-not-a-valid-cursor",
      }),
    ).rejects.toThrow("Invalid audit history cursor");
  });

  it("returns both preference and definition events for a subjectSlug and narrows with targetType", async () => {
    await createAuditEvent({
      id: "audit-pref",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-a",
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date("2026-04-18T10:00:00.000Z"),
    });
    await createAuditEvent({
      id: "audit-def",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE_DEFINITION,
      targetId: "def-a",
      eventType: AuditEventType.DEFINITION_UPDATED,
      occurredAt: new Date("2026-04-18T11:00:00.000Z"),
    });

    const mixedPage = await queryService.getHistory(primaryUserId, {
      subjectSlug: "food.dietary_restrictions",
    });
    const preferenceOnlyPage = await queryService.getHistory(primaryUserId, {
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
    });

    expect(mixedPage.items.map((item) => item.id)).toEqual([
      "audit-def",
      "audit-pref",
    ]);
    expect(preferenceOnlyPage.items.map((item) => item.id)).toEqual(["audit-pref"]);
  });

  it("AND-composes origin, actorClientKey, eventType, correlationId, and date filters", async () => {
    await createAuditEvent({
      id: "audit-match",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-match",
      eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
      actorType: AuditActorType.MCP_CLIENT,
      actorClientKey: "codex",
      origin: AuditOrigin.MCP,
      correlationId: "corr-match",
      occurredAt: new Date("2026-04-18T12:00:00.000Z"),
    });
    await createAuditEvent({
      id: "audit-wrong-client",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-wrong-client",
      eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
      actorType: AuditActorType.MCP_CLIENT,
      actorClientKey: "claude",
      origin: AuditOrigin.MCP,
      correlationId: "corr-match",
      occurredAt: new Date("2026-04-18T12:00:00.000Z"),
    });
    await createAuditEvent({
      id: "audit-wrong-date",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-wrong-date",
      eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
      actorType: AuditActorType.MCP_CLIENT,
      actorClientKey: "codex",
      origin: AuditOrigin.MCP,
      correlationId: "corr-match",
      occurredAt: new Date("2026-04-19T12:00:00.000Z"),
    });

    const page = await queryService.getHistory(primaryUserId, {
      subjectSlug: "food.dietary_restrictions",
      eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
      origin: AuditOrigin.MCP,
      actorClientKey: "codex",
      correlationId: "corr-match",
      occurredFrom: new Date("2026-04-18T00:00:00.000Z"),
      occurredTo: new Date("2026-04-18T23:59:59.999Z"),
    });

    expect(page.items.map((item) => item.id)).toEqual(["audit-match"]);
  });

  it("never returns another user's audit events", async () => {
    await createAuditEvent({
      id: "audit-primary",
      userId: primaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-primary",
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date("2026-04-18T10:00:00.000Z"),
    });
    await createAuditEvent({
      id: "audit-secondary",
      userId: secondaryUserId,
      subjectSlug: "food.dietary_restrictions",
      targetType: AuditTargetType.PREFERENCE,
      targetId: "pref-secondary",
      eventType: AuditEventType.PREFERENCE_SET,
      occurredAt: new Date("2026-04-18T11:00:00.000Z"),
    });

    const page = await queryService.getHistory(primaryUserId, {
      subjectSlug: "food.dietary_restrictions",
    });

    expect(page.items.map((item) => item.id)).toEqual(["audit-primary"]);
  });
});
