import { PreferenceAuditService } from "@/modules/preferences/audit/preference-audit.service";
import { postgresClient } from "./postgres-client";
import { Injectable } from "@nestjs/common";

import { Prisma } from "@infrastructure/prisma/generated-client";
import { AuditEventInput } from "@modules/preferences/audit/audit.types";

@Injectable()
export class PostgresPreferenceAuditService implements PreferenceAuditService {
  constructor(private prisma: Prisma.TransactionClient) {
    this.prisma = postgresClient(this.prisma);
  }

  async record(event: AuditEventInput): Promise<void> {
    const subjectSlug = event.subjectSlug.trim();

    if (!subjectSlug) {
      throw new Error("Audit event subjectSlug is required");
    }

    const client = this.prisma;

    await client.preferenceAuditEvent.create({
      data: {
        userId: event.userId,
        subjectSlug,
        targetType: event.targetType,
        targetId: event.targetId,
        eventType: event.eventType,
        actorType: event.actorType,
        actorClientKey: event.actorClientKey,
        origin: event.origin,
        correlationId: event.correlationId,
        beforeState: event.beforeState ?? undefined,
        afterState: event.afterState ?? undefined,
        metadata: event.metadata ?? undefined,
      },
    });
  }
}
