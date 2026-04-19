import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import type { PreferenceAuditEvent as PrismaPreferenceAuditEvent } from '@infrastructure/prisma/prisma-models';
import { Prisma } from '@infrastructure/prisma/generated-client';
import { PreferenceAuditHistoryInput } from './dto/preference-audit-history.input';

interface AuditCursorPayload {
  occurredAt: string;
  id: string;
}

export interface PreferenceAuditHistoryPage {
  items: PrismaPreferenceAuditEvent[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

@Injectable()
export class PreferenceAuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(
    userId: string,
    input: PreferenceAuditHistoryInput,
  ): Promise<PreferenceAuditHistoryPage> {
    const first = input.first ?? 20;
    const cursor = input.after ? this.decodeCursor(input.after) : null;

    const where: Prisma.PreferenceAuditEventWhereInput = {
      userId,
      ...(input.subjectSlug ? { subjectSlug: input.subjectSlug } : {}),
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.actorClientKey ? { actorClientKey: input.actorClientKey } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
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

    const rows = await this.prisma.preferenceAuditEvent.findMany({
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

  private encodeCursor(event: Pick<PrismaPreferenceAuditEvent, 'occurredAt' | 'id'>): string {
    return Buffer.from(
      JSON.stringify({
        occurredAt: event.occurredAt.toISOString(),
        id: event.id,
      } satisfies AuditCursorPayload),
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): { occurredAt: Date; id: string } {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<AuditCursorPayload>;

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
      throw new BadRequestException('Invalid audit history cursor');
    }
  }
}
