import type { Prisma } from "@infrastructure/prisma/generated-client";
import {
  AuditHistoryStorage,
  type AuditHistoryFilter,
  type HistoryCursor,
} from "@/domains/shared/storage/history-storage";
import { postgresClient } from "./postgres-client";
export class PostgresAuditHistoryStorage implements AuditHistoryStorage {
  constructor(private client: Prisma.TransactionClient) {
    this.client = postgresClient(client);
  }
  async findPage(
    userId: string,
    filter: AuditHistoryFilter,
    cursor: HistoryCursor | null,
    limit: number,
  ) {
    const subjectSlugPrefix = filter.subjectSlug;
    const where: Prisma.PreferenceAuditEventWhereInput = {
      userId,
      ...(subjectSlugPrefix
        ? {
            subjectSlug: {
              startsWith: subjectSlugPrefix,
            },
          }
        : {}),
      ...(filter.eventType ? { eventType: filter.eventType } : {}),
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.origin ? { origin: filter.origin } : {}),
      ...(filter.actorClientKey
        ? { actorClientKey: filter.actorClientKey }
        : {}),
      ...(filter.correlationId ? { correlationId: filter.correlationId } : {}),
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

    const rows = await this.client.preferenceAuditEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    return rows;
  }
}
