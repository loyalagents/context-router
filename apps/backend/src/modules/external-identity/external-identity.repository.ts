import { Injectable, Logger } from '@nestjs/common';
import type { ExternalIdentity } from "@/domains/shared/storage/storage-types";
import { PrismaService } from '@infrastructure/prisma/prisma.service';

@Injectable()
export class ExternalIdentityRepository {
  private readonly logger = new Logger(ExternalIdentityRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByProviderAndUserId(
    provider: string,
    issuer: string,
    providerUserId: string,
  ): Promise<ExternalIdentity | null> {
    this.logger.debug('Looking up an external identity');
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
    this.logger.debug('Looking up external identities for a user');
    return this.prisma.externalIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    userId: string;
    provider: string;
    issuer: string;
    providerUserId: string;
    metadata?: any;
  }): Promise<ExternalIdentity> {
    this.logger.debug('Creating an external identity');
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
      metadata?: any;
    },
  ): Promise<ExternalIdentity> {
    this.logger.debug('Updating external identity metadata');
    return this.prisma.externalIdentity.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ExternalIdentity> {
    this.logger.debug('Deleting an external identity');
    return this.prisma.externalIdentity.delete({ where: { id } });
  }

  async linkIdentityToUser(
    userId: string,
    provider: string,
    issuer: string,
    providerUserId: string,
    metadata?: any,
  ): Promise<ExternalIdentity> {
    this.logger.debug('Linking an external identity to a user');
    return this.create({
      userId,
      provider,
      issuer,
      providerUserId,
      metadata,
    });
  }
}
