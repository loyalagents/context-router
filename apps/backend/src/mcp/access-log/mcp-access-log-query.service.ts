import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import type { McpAccessEvent as PrismaMcpAccessEvent } from '@infrastructure/prisma/prisma-models';
import { Prisma } from '@infrastructure/prisma/generated-client';
import { McpAccessHistoryInput } from './dto/mcp-access-history.input';

interface McpAccessCursorPayload {
  occurredAt: string;
  id: string;
}

export interface McpAccessHistoryPage {
  items: PrismaMcpAccessEvent[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

@Injectable()
export class McpAccessLogQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(
    userId: string,
    input: McpAccessHistoryInput,
  ): Promise<McpAccessHistoryPage> {
    const first = input.first ?? 20;
    const cursor = input.after ? this.decodeCursor(input.after) : null;

    const where: Prisma.McpAccessEventWhereInput = {
      userId,
      ...(input.clientKey?.trim()
        ? { clientKey: input.clientKey.trim() }
        : {}),
      ...(input.surface ? { surface: input.surface } : {}),
      ...(input.operationName?.trim()
        ? { operationName: input.operationName.trim() }
        : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.correlationId?.trim()
        ? { correlationId: input.correlationId.trim() }
        : {}),
      ...(input.occurredFrom || input.occurredTo
        ? {
            occurredAt: {
              ...(input.occurredFrom ? { gte: input.occurredFrom } : {}),
              ...(input.occurredTo ? { lte: input.occurredTo } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { occurredAt: { lt: cursor.occurredAt } },
              {
                AND: [
                  { occurredAt: cursor.occurredAt },
                  { id: { lt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.mcpAccessEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
    });

    const hasNextPage = rows.length > first;
    const items = hasNextPage ? rows.slice(0, first) : rows;
    const nextCursor =
      hasNextPage && items.length > 0
        ? this.encodeCursor(items[items.length - 1])
        : null;

    return {
      items,
      nextCursor,
      hasNextPage,
    };
  }

  private encodeCursor(
    event: Pick<PrismaMcpAccessEvent, 'occurredAt' | 'id'>,
  ): string {
    return Buffer.from(
      JSON.stringify({
        occurredAt: event.occurredAt.toISOString(),
        id: event.id,
      } satisfies McpAccessCursorPayload),
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): { occurredAt: Date; id: string } {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<McpAccessCursorPayload>;

      if (
        typeof decoded.occurredAt !== 'string' ||
        !decoded.occurredAt ||
        typeof decoded.id !== 'string' ||
        !decoded.id
      ) {
        throw new Error('missing fields');
      }

      const occurredAt = new Date(decoded.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) {
        throw new Error('invalid timestamp');
      }

      return { occurredAt, id: decoded.id };
    } catch {
      throw new BadRequestException('Invalid MCP access history cursor');
    }
  }
}
