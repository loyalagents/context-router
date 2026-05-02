import {
  McpAccessOutcome,
  McpAccessSurface,
} from '@infrastructure/prisma/generated-client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { McpAccessLogQueryService } from '../../src/mcp/access-log/mcp-access-log-query.service';
import { getPrismaClient } from '../setup/test-db';

describe('McpAccessLogQueryService (integration)', () => {
  let prisma: PrismaService;
  let queryService: McpAccessLogQueryService;
  let primaryUserId: string;
  let secondaryUserId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    queryService = new McpAccessLogQueryService(prisma);
  });

  beforeEach(async () => {
    const [primaryUser, secondaryUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'mcp-access-query-primary@example.com',
        },
      }),
      prisma.user.create({
        data: {
          email: 'mcp-access-query-secondary@example.com',
        },
      }),
    ]);

    primaryUserId = primaryUser.userId;
    secondaryUserId = secondaryUser.userId;
  });

  async function createAccessEvent(params: {
    id: string;
    userId: string;
    clientKey?: string;
    surface?: McpAccessSurface;
    operationName?: string;
    outcome?: McpAccessOutcome;
    correlationId?: string;
    latencyMs?: number;
    occurredAt: Date;
  }) {
    return prisma.mcpAccessEvent.create({
      data: {
        id: params.id,
        userId: params.userId,
        clientKey: params.clientKey ?? 'codex',
        surface: params.surface ?? McpAccessSurface.TOOLS_CALL,
        operationName: params.operationName ?? 'searchPreferences',
        outcome: params.outcome ?? McpAccessOutcome.SUCCESS,
        correlationId: params.correlationId ?? `corr-${params.id}`,
        latencyMs: params.latencyMs ?? 1,
        occurredAt: params.occurredAt,
      },
    });
  }

  it('returns newest-first ordering using occurredAt desc and id desc', async () => {
    const sharedTime = new Date('2026-04-20T10:00:00.000Z');

    await createAccessEvent({
      id: 'access-a',
      userId: primaryUserId,
      occurredAt: sharedTime,
    });
    await createAccessEvent({
      id: 'access-b',
      userId: primaryUserId,
      occurredAt: sharedTime,
    });
    await createAccessEvent({
      id: 'access-c',
      userId: primaryUserId,
      operationName: 'schema://graphql',
      surface: McpAccessSurface.RESOURCES_READ,
      occurredAt: new Date('2026-04-20T11:00:00.000Z'),
    });

    const page = await queryService.getHistory(primaryUserId, {});

    expect(page.items.map((item) => item.id)).toEqual([
      'access-c',
      'access-b',
      'access-a',
    ]);
    expect(page.hasNextPage).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('returns a stable next page with cursor pagination', async () => {
    const sharedTime = new Date('2026-04-20T10:00:00.000Z');

    await createAccessEvent({
      id: 'access-a',
      userId: primaryUserId,
      occurredAt: sharedTime,
    });
    await createAccessEvent({
      id: 'access-b',
      userId: primaryUserId,
      occurredAt: sharedTime,
    });
    await createAccessEvent({
      id: 'access-c',
      userId: primaryUserId,
      occurredAt: new Date('2026-04-20T11:00:00.000Z'),
    });

    const firstPage = await queryService.getHistory(primaryUserId, { first: 2 });

    expect(firstPage.items.map((item) => item.id)).toEqual([
      'access-c',
      'access-b',
    ]);
    expect(firstPage.hasNextPage).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await queryService.getHistory(primaryUserId, {
      first: 2,
      after: firstPage.nextCursor!,
    });

    expect(secondPage.items.map((item) => item.id)).toEqual(['access-a']);
    expect(secondPage.hasNextPage).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('returns an empty page when no events match', async () => {
    const page = await queryService.getHistory(primaryUserId, {
      operationName: 'missingTool',
    });

    expect(page).toEqual({
      items: [],
      hasNextPage: false,
      nextCursor: null,
    });
  });

  it('rejects malformed cursors with a BadRequestException', async () => {
    await expect(
      queryService.getHistory(primaryUserId, {
        after: 'definitely-not-a-valid-cursor',
      }),
    ).rejects.toThrow('Invalid MCP access history cursor');
  });

  it('includes events that land exactly on the occurredFrom and occurredTo boundaries', async () => {
    const rangeStart = new Date('2026-04-20T10:00:00.000Z');
    const rangeEnd = new Date('2026-04-20T11:00:00.000Z');

    await createAccessEvent({
      id: 'access-before-range',
      userId: primaryUserId,
      occurredAt: new Date('2026-04-20T09:59:59.999Z'),
    });
    await createAccessEvent({
      id: 'access-at-start',
      userId: primaryUserId,
      occurredAt: rangeStart,
    });
    await createAccessEvent({
      id: 'access-middle',
      userId: primaryUserId,
      occurredAt: new Date('2026-04-20T10:30:00.000Z'),
    });
    await createAccessEvent({
      id: 'access-at-end',
      userId: primaryUserId,
      occurredAt: rangeEnd,
    });
    await createAccessEvent({
      id: 'access-after-range',
      userId: primaryUserId,
      occurredAt: new Date('2026-04-20T11:00:00.001Z'),
    });

    const page = await queryService.getHistory(primaryUserId, {
      occurredFrom: rangeStart,
      occurredTo: rangeEnd,
    });

    expect(page.items.map((item) => item.id)).toEqual([
      'access-at-end',
      'access-middle',
      'access-at-start',
    ]);
  });

  it('AND-composes client, surface, operation, outcome, correlation, and date filters', async () => {
    await createAccessEvent({
      id: 'access-match',
      userId: primaryUserId,
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'smartSearchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      correlationId: 'corr-match',
      occurredAt: new Date('2026-04-20T12:00:00.000Z'),
    });
    await createAccessEvent({
      id: 'access-wrong-client',
      userId: primaryUserId,
      clientKey: 'claude',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'smartSearchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      correlationId: 'corr-match',
      occurredAt: new Date('2026-04-20T12:00:00.000Z'),
    });
    await createAccessEvent({
      id: 'access-wrong-outcome',
      userId: primaryUserId,
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'smartSearchPreferences',
      outcome: McpAccessOutcome.ERROR,
      correlationId: 'corr-match',
      occurredAt: new Date('2026-04-20T12:00:00.000Z'),
    });

    const page = await queryService.getHistory(primaryUserId, {
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'smartSearchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      correlationId: 'corr-match',
      occurredFrom: new Date('2026-04-20T00:00:00.000Z'),
      occurredTo: new Date('2026-04-20T23:59:59.999Z'),
    });

    expect(page.items.map((item) => item.id)).toEqual(['access-match']);
  });

  it("never returns another user's MCP access events", async () => {
    await createAccessEvent({
      id: 'access-primary',
      userId: primaryUserId,
      occurredAt: new Date('2026-04-20T10:00:00.000Z'),
    });
    await createAccessEvent({
      id: 'access-secondary',
      userId: secondaryUserId,
      occurredAt: new Date('2026-04-20T11:00:00.000Z'),
    });

    const page = await queryService.getHistory(primaryUserId, {});

    expect(page.items.map((item) => item.id)).toEqual(['access-primary']);
  });
});
