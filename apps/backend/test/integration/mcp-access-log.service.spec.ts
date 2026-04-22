import {
  McpAccessOutcome,
  McpAccessSurface,
} from '@infrastructure/prisma/generated-client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { McpAccessLogService } from '../../src/mcp/access-log/mcp-access-log.service';
import { getPrismaClient } from '../setup/test-db';

describe('McpAccessLogService (integration)', () => {
  let prisma: PrismaService;
  let service: McpAccessLogService;
  let testUserId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    service = new McpAccessLogService(prisma);
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: 'mcp-access-log@example.com',
        firstName: 'Mcp',
        lastName: 'Access',
      },
    });

    testUserId = user.userId;
  });

  it('exposes the expected MCP access enums', () => {
    expect(McpAccessSurface).toMatchObject({
      TOOLS_CALL: 'TOOLS_CALL',
      RESOURCES_READ: 'RESOURCES_READ',
    });

    expect(McpAccessOutcome).toMatchObject({
      SUCCESS: 'SUCCESS',
      DENY: 'DENY',
      ERROR: 'ERROR',
    });
  });

  it('records an access row with base fields and JSON metadata', async () => {
    await service.record({
      userId: testUserId,
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'searchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      correlationId: 'corr-search',
      latencyMs: 12.4,
      requestMetadata: {
        locationId: null,
        includeSuggestions: true,
        queryPresent: true,
        queryLength: 4,
      },
      responseMetadata: {
        activeCount: 1,
        suggestedCount: 2,
      },
    });

    const stored = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUserId },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      userId: testUserId,
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'searchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      correlationId: 'corr-search',
      latencyMs: 12,
      requestMetadata: {
        locationId: null,
        includeSuggestions: true,
        queryPresent: true,
        queryLength: 4,
      },
      responseMetadata: {
        activeCount: 1,
        suggestedCount: 2,
      },
      errorMetadata: null,
    });
    expect(stored[0].id).toBeDefined();
    expect(stored[0].occurredAt).toBeInstanceOf(Date);
  });

  it('supports the intended indexed query patterns', async () => {
    await service.record({
      userId: testUserId,
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'searchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      correlationId: 'corr-shared',
      latencyMs: 5,
    });
    await service.record({
      userId: testUserId,
      clientKey: 'claude',
      surface: McpAccessSurface.RESOURCES_READ,
      operationName: 'schema://graphql',
      outcome: McpAccessOutcome.ERROR,
      correlationId: 'corr-resource',
      latencyMs: 7,
      errorMetadata: { source: 'DISPATCH' },
    });
    await service.record({
      userId: testUserId,
      clientKey: 'codex',
      surface: McpAccessSurface.TOOLS_CALL,
      operationName: 'smartSearchPreferences',
      outcome: McpAccessOutcome.SUCCESS,
      correlationId: 'corr-shared',
      latencyMs: 9,
    });

    const byClient = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUserId, clientKey: 'codex' },
      orderBy: { occurredAt: 'desc' },
    });
    const byOperation = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUserId, operationName: 'schema://graphql' },
    });
    const byOutcome = await prisma.mcpAccessEvent.findMany({
      where: { userId: testUserId, outcome: McpAccessOutcome.SUCCESS },
    });
    const byCorrelation = await prisma.mcpAccessEvent.findMany({
      where: { correlationId: 'corr-shared' },
    });

    expect(byClient).toHaveLength(2);
    expect(byClient.every((event) => event.clientKey === 'codex')).toBe(true);
    expect(byOperation).toHaveLength(1);
    expect(byOperation[0]).toMatchObject({
      operationName: 'schema://graphql',
      outcome: McpAccessOutcome.ERROR,
    });
    expect(byOutcome).toHaveLength(2);
    expect(byCorrelation).toHaveLength(2);
  });

  it('throws when required string fields are blank', async () => {
    await expect(
      service.record({
        userId: testUserId,
        clientKey: 'codex',
        surface: McpAccessSurface.TOOLS_CALL,
        operationName: ' ',
        outcome: McpAccessOutcome.SUCCESS,
        correlationId: 'corr-blank',
        latencyMs: 1,
      }),
    ).rejects.toThrow('MCP access event operationName is required');

    await expect(
      service.record({
        userId: testUserId,
        clientKey: ' ',
        surface: McpAccessSurface.TOOLS_CALL,
        operationName: 'searchPreferences',
        outcome: McpAccessOutcome.SUCCESS,
        correlationId: 'corr-blank',
        latencyMs: 1,
      }),
    ).rejects.toThrow('MCP access event clientKey is required');
  });
});
