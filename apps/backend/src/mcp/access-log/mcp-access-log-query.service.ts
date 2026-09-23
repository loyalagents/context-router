import { BadRequestException, Injectable } from '@nestjs/common';
import { AccessHistoryStorage } from '@/domains/shared/storage/history-storage';
import type { McpAccessEvent as StoredMcpAccessEvent } from "@/domains/shared/storage/storage-types";
import { McpAccessHistoryInput } from './dto/mcp-access-history.input';

interface McpAccessCursorPayload {
  occurredAt: string;
  id: string;
}

export interface McpAccessHistoryPage {
  items: StoredMcpAccessEvent[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

@Injectable()
export class McpAccessLogQueryService {
  constructor(private readonly storage: AccessHistoryStorage) {}

  async getHistory(
    userId: string,
    input: McpAccessHistoryInput,
  ): Promise<McpAccessHistoryPage> {
    const first = input.first ?? 20;
    const cursor = input.after ? this.decodeCursor(input.after) : null;

    const rows = await this.storage.findPage(userId, { clientKey: input.clientKey?.trim(), surface: input.surface, operationName: input.operationName?.trim(), outcome: input.outcome, correlationId: input.correlationId?.trim(), occurredFrom: input.occurredFrom, occurredTo: input.occurredTo }, cursor, first + 1);

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
    event: Pick<StoredMcpAccessEvent, 'occurredAt' | 'id'>,
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
