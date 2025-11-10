import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { ExternalIdentity } from '@prisma/client';

@Injectable()
export class ExternalIdentityRepository {
  private readonly logger = new Logger(ExternalIdentityRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByProviderAndUserId(
    provider: string,
    providerUserId: string,
  ): Promise<ExternalIdentity | null> {
    this.logger.log(
      `Finding external identity: provider=${provider}, providerUserId=${providerUserId}`,
    );
    return this.prisma.externalIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
    });
  }

  async findByUserId(userId: string): Promise<ExternalIdentity[]> {
    this.logger.log(`Finding external identities for user: ${userId}`);
    return this.prisma.externalIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    userId: string;
    provider: string;
    providerUserId: string;
    metadata?: any;
  }): Promise<ExternalIdentity> {
    this.logger.log(
      `Creating external identity: provider=${data.provider}, providerUserId=${data.providerUserId}`,
    );
    return this.prisma.externalIdentity.create({
      data: {
        userId: data.userId,
        provider: data.provider,
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
    this.logger.log(`Updating external identity: ${id}`);
    return this.prisma.externalIdentity.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ExternalIdentity> {
    this.logger.log(`Deleting external identity: ${id}`);
    return this.prisma.externalIdentity.delete({
      where: { id },
    });
  }

  async linkIdentityToUser(
    userId: string,
    provider: string,
    providerUserId: string,
    metadata?: any,
  ): Promise<ExternalIdentity> {
    this.logger.log(
      `Linking ${provider} identity ${providerUserId} to user ${userId}`,
    );
    return this.create({
      userId,
      provider,
      providerUserId,
      metadata,
    });
  }
}
