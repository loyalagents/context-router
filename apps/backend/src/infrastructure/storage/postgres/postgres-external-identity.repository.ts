import { ExternalIdentityRepository } from "@/modules/external-identity/external-identity.repository";
import { postgresClient } from "./postgres-client";
import { Injectable, Logger } from "@nestjs/common";
import type { ExternalIdentity, JsonInput } from "@/domains/shared/storage/storage-types";
import { Prisma } from "@infrastructure/prisma/generated-client";

@Injectable()
export class PostgresExternalIdentityRepository
  implements ExternalIdentityRepository
{
  private readonly logger = new Logger(PostgresExternalIdentityRepository.name);

  constructor(private prisma: Prisma.TransactionClient) {
    this.prisma = postgresClient(this.prisma);
  }

  async findByProviderAndUserId(
    provider: string,
    issuer: string,
    providerUserId: string,
  ): Promise<ExternalIdentity | null> {
    this.logger.debug("Looking up an external identity");
    return this.prisma.externalIdentity.findUnique({
      where: {
        provider_issuer_providerUserId: {
          provider,
          issuer,
          providerUserId,
        },
      },
    });
  }

  async findByUserId(userId: string): Promise<ExternalIdentity[]> {
    this.logger.debug("Looking up external identities for a user");
    return this.prisma.externalIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: {
    userId: string;
    provider: string;
    issuer: string;
    providerUserId: string;
    metadata?: JsonInput;
  }): Promise<ExternalIdentity> {
    this.logger.debug("Creating an external identity");
    return this.prisma.externalIdentity.create({
      data: {
        userId: data.userId,
        provider: data.provider,
        issuer: data.issuer,
        providerUserId: data.providerUserId,
        metadata: data.metadata,
      },
    });
  }

  async update(
    id: string,
    data: {
      metadata?: JsonInput;
    },
  ): Promise<ExternalIdentity> {
    this.logger.debug("Updating external identity metadata");
    return this.prisma.externalIdentity.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ExternalIdentity> {
    this.logger.debug("Deleting an external identity");
    return this.prisma.externalIdentity.delete({ where: { id } });
  }

  async linkIdentityToUser(
    userId: string,
    provider: string,
    issuer: string,
    providerUserId: string,
    metadata?: JsonInput,
  ): Promise<ExternalIdentity> {
    this.logger.debug("Linking an external identity to a user");
    return this.create({
      userId,
      provider,
      issuer,
      providerUserId,
      metadata,
    });
  }
}
