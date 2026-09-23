import type { Prisma } from "@infrastructure/prisma/generated-client";
import {
  AccessHistoryStorage,
  type AccessHistoryFilter,
  type HistoryCursor,
  type AccessEvent,
} from "@/domains/shared/storage/history-storage";
import { postgresClient } from "./postgres-client";
export class PostgresAccessHistoryStorage implements AccessHistoryStorage {
  constructor(private client: Prisma.TransactionClient) {
    this.client = postgresClient(client);
  }
  async append(event: AccessEvent): Promise<void> {
    await this.client.mcpAccessEvent.create({
      data: {
        ...event,
        requestMetadata: event.requestMetadata ?? undefined,
        responseMetadata: event.responseMetadata ?? undefined,
        errorMetadata: event.errorMetadata ?? undefined,
      },
    });
  }
  async findPage(
    userId: string,
    filter: AccessHistoryFilter,
    cursor: HistoryCursor | null,
    limit: number,
  ) {
    const where: Prisma.McpAccessEventWhereInput = {
      userId,
      ...(filter.clientKey?.trim()
        ? { clientKey: filter.clientKey.trim() }
        : {}),
      ...(filter.surface ? { surface: filter.surface } : {}),
      ...(filter.operationName?.trim()
        ? { operationName: filter.operationName.trim() }
        : {}),
      ...(filter.outcome ? { outcome: filter.outcome } : {}),
      ...(filter.correlationId?.trim()
        ? { correlationId: filter.correlationId.trim() }
        : {}),
      ...(filter.occurredFrom || filter.occurredTo
        ? {
            occurredAt: {
              ...(filter.occurredFrom ? { gte: filter.occurredFrom } : {}),
              ...(filter.occurredTo ? { lte: filter.occurredTo } : {}),
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

    const rows = await this.client.mcpAccessEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    return rows;
  }
}
