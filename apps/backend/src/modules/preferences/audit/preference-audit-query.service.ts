import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditHistoryStorage } from '@/domains/shared/storage/history-storage';
import type { PreferenceAuditEvent as StoredPreferenceAuditEvent } from "@/domains/shared/storage/storage-types";
import { PreferenceAuditHistoryInput } from './dto/preference-audit-history.input';

interface AuditCursorPayload {
  occurredAt: string;
  id: string;
}

export interface PreferenceAuditHistoryPage {
  items: StoredPreferenceAuditEvent[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

@Injectable()
export class PreferenceAuditQueryService {
  constructor(private readonly storage: AuditHistoryStorage) {}

  async getHistory(
    userId: string,
    input: PreferenceAuditHistoryInput,
  ): Promise<PreferenceAuditHistoryPage> {
    const first = input.first ?? 20;
    const cursor = input.after ? this.decodeCursor(input.after) : null;
    const subjectSlugPrefix = input.subjectSlug?.trim();

    const rows = await this.storage.findPage(userId, { subjectSlug: subjectSlugPrefix, eventType: input.eventType, targetType: input.targetType, origin: input.origin, actorClientKey: input.actorClientKey, correlationId: input.correlationId, occurredFrom: input.occurredFrom, occurredTo: input.occurredTo }, cursor, first + 1);

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

  private encodeCursor(event: Pick<StoredPreferenceAuditEvent, 'occurredAt' | 'id'>): string {
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
