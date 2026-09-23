import type { Prisma } from "@infrastructure/prisma/generated-client";
import type { ResetStorage } from "@/domains/shared/storage/reset-storage";
import { postgresClient } from "./postgres-client";

export class PostgresResetStorage implements ResetStorage {
  constructor(private client: Prisma.TransactionClient) {
    this.client = postgresClient(client);
  }
  async deletePreferences(userId: string) {
    return (await this.client.preference.deleteMany({ where: { userId } }))
      .count;
  }
  async appendMemoryResetAudit(
    userId: string,
    mode: string,
    preferencesDeleted: number,
    correlationId: string,
  ) {
    await this.client.preferenceAuditEvent.create({
      data: {
        userId,
        subjectSlug: "*",
        targetType: "PREFERENCE",
        targetId: userId,
        eventType: "PREFERENCES_RESET",
        actorType: "USER",
        origin: "GRAPHQL",
        correlationId,
        beforeState: null,
        afterState: null,
        metadata: { mode, preferencesDeleted },
      },
    });
  }
  async deleteAuditEvents(userId: string) {
    return (
      await this.client.preferenceAuditEvent.deleteMany({ where: { userId } })
    ).count;
  }
  async deleteAccessEvents(userId: string) {
    return (await this.client.mcpAccessEvent.deleteMany({ where: { userId } }))
      .count;
  }
  async findOwnedDefinitionIds(userId: string) {
    const rows = await this.client.preferenceDefinition.findMany({
      where: { namespace: `USER:${userId}`, ownerUserId: userId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
  async hasForeignDefinitionReference(userId: string, definitionIds: string[]) {
    return !!(await this.client.preference.findFirst({
      where: { definitionId: { in: definitionIds }, userId: { not: userId } },
      select: { userId: true, definitionId: true },
    }));
  }
  async deleteDefinitions(definitionIds: string[]) {
    return (
      await this.client.preferenceDefinition.deleteMany({
        where: { id: { in: definitionIds } },
      })
    ).count;
  }
  async deleteLocations(userId: string) {
    return (await this.client.location.deleteMany({ where: { userId } })).count;
  }
  async deleteGrants(userId: string) {
    return (await this.client.permissionGrant.deleteMany({ where: { userId } }))
      .count;
  }
}
