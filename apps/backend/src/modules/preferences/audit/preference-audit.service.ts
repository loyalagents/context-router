import { Injectable } from "@nestjs/common";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import { Prisma } from "@infrastructure/prisma/generated-client";
import { AuditEventInput } from "./audit.types";

@Injectable()
export class PreferenceAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    event: AuditEventInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const subjectSlug = event.subjectSlug.trim();

    if (!subjectSlug) {
      throw new Error("Audit event subjectSlug is required");
    }

    const client = tx ?? this.prisma;

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
