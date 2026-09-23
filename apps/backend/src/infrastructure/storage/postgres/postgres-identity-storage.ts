import { Prisma } from "@infrastructure/prisma/generated-client";
import {
  IdentityStorage,
  type IdentityTransaction,
  type HumanIdentityKey,
} from "@/domains/shared/storage/identity-storage";
import { postgresClient } from "./postgres-client";

export class PostgresIdentityStorage
  implements IdentityStorage, IdentityTransaction
{
  constructor(private client: Prisma.TransactionClient) {
    this.client = postgresClient(client);
  }
  async findExact({ provider, issuer, subject }: HumanIdentityKey) {
    const identity = await this.client.externalIdentity.findUnique({
      where: {
        provider_issuer_providerUserId: {
          provider,
          issuer,
          providerUserId: subject,
        },
      },
      include: { user: true },
    });
    return identity?.user ?? null;
  }
  createPrincipal(userId: string, email: string) {
    return this.client.user.create({ data: { userId, email } });
  }
  async createVerifiedBinding(
    userId: string,
    { provider, issuer, subject }: HumanIdentityKey,
  ) {
    await this.client.externalIdentity.create({
      data: {
        userId,
        provider,
        issuer,
        providerUserId: subject,
        metadata: Prisma.JsonNull,
      },
    });
  }
  upsertM2MPrincipal(userId: string, email: string) {
    return this.client.user.upsert({
      where: { userId },
      create: { userId, email },
      update: {},
    });
  }
  countBindings(userId: string) {
    return this.client.externalIdentity.count({ where: { userId } });
  }
  findInitialProfileDefinitions(slugs: string[]) {
    return this.client.preferenceDefinition.findMany({
      where: { namespace: "GLOBAL", slug: { in: slugs }, archivedAt: null },
      select: { id: true, slug: true },
    });
  }
  async hasInitialProfileValue(userId: string, definitionId: string) {
    return !!(await this.client.preference.findFirst({
      where: { userId, contextKey: "GLOBAL", definitionId, status: "ACTIVE" },
      select: { id: true },
    }));
  }
  async createInitialProfileValue(
    userId: string,
    definitionId: string,
    value: string,
  ) {
    await this.client.preference.create({
      data: {
        userId,
        locationId: null,
        contextKey: "GLOBAL",
        definitionId,
        value,
        status: "ACTIVE",
        sourceType: "IMPORTED",
        confidence: null,
        evidence: { source: "verified_identity" },
      },
    });
  }
}
