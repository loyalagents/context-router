import { Injectable, Logger } from '@nestjs/common';
import { ExternalIdentityRepository } from './external-identity.repository';
import { ExternalIdentity } from '@prisma/client';

@Injectable()
export class ExternalIdentityService {
  private readonly logger = new Logger(ExternalIdentityService.name);

  constructor(
    private readonly externalIdentityRepository: ExternalIdentityRepository,
  ) {}

  async findByProviderAndUserId(
    provider: string,
    providerUserId: string,
  ): Promise<ExternalIdentity | null> {
    this.logger.log(
      `Looking up ${provider} identity: ${providerUserId}`,
    );
    return this.externalIdentityRepository.findByProviderAndUserId(
      provider,
      providerUserId,
    );
  }

  async findByUserId(userId: string): Promise<ExternalIdentity[]> {
    this.logger.log(`Getting all identities for user: ${userId}`);
    return this.externalIdentityRepository.findByUserId(userId);
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

    // Check if this identity is already linked to this user
    const existing = await this.externalIdentityRepository.findByProviderAndUserId(
      provider,
      providerUserId,
    );

    if (existing) {
      if (existing.userId === userId) {
        this.logger.debug('Identity already linked to this user');
        return existing;
      } else {
        throw new Error(
          `This ${provider} identity is already linked to another user`,
        );
      }
    }

    return this.externalIdentityRepository.linkIdentityToUser(
      userId,
      provider,
      providerUserId,
      metadata,
    );
  }

  async updateMetadata(
    id: string,
    metadata: any,
  ): Promise<ExternalIdentity> {
    this.logger.log(`Updating metadata for external identity: ${id}`);
    return this.externalIdentityRepository.update(id, { metadata });
  }

  async unlinkIdentity(id: string): Promise<ExternalIdentity> {
    this.logger.log(`Unlinking external identity: ${id}`);
    return this.externalIdentityRepository.delete(id);
  }

  async findUserIdByProviderIdentity(
    provider: string,
    providerUserId: string,
  ): Promise<string | null> {
    const identity = await this.findByProviderAndUserId(
      provider,
      providerUserId,
    );
    return identity?.userId || null;
  }
}
