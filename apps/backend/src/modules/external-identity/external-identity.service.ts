import { Injectable, Logger } from "@nestjs/common";
import type { ExternalIdentity } from "@infrastructure/prisma/prisma-models";
import { ExternalIdentityRepository } from "./external-identity.repository";

@Injectable()
export class ExternalIdentityService {
  private readonly logger = new Logger(ExternalIdentityService.name);

  constructor(
    private readonly externalIdentityRepository: ExternalIdentityRepository,
  ) {}

  async findByProviderAndUserId(
    provider: string,
    issuer: string,
    providerUserId: string,
  ): Promise<ExternalIdentity | null> {
    this.logger.debug("Looking up an external identity");
    return this.externalIdentityRepository.findByProviderAndUserId(
      provider,
      issuer,
      providerUserId,
    );
  }

  async findByUserId(userId: string): Promise<ExternalIdentity[]> {
    this.logger.debug("Looking up external identities for a user");
    return this.externalIdentityRepository.findByUserId(userId);
  }

  async linkIdentityToUser(
    userId: string,
    provider: string,
    issuer: string,
    providerUserId: string,
    metadata?: any,
  ): Promise<ExternalIdentity> {
    this.logger.debug("Linking an external identity to a user");

    // Check if this identity is already linked to this user
    const existing =
      await this.externalIdentityRepository.findByProviderAndUserId(
        provider,
        issuer,
        providerUserId,
      );

    if (existing) {
      if (existing.userId === userId) {
        this.logger.debug("Identity already linked to this user");
        return existing;
      } else {
        throw new Error("External identity is linked to another user");
      }
    }

    return this.externalIdentityRepository.linkIdentityToUser(
      userId,
      provider,
      issuer,
      providerUserId,
      metadata,
    );
  }

  async updateMetadata(id: string, metadata: any): Promise<ExternalIdentity> {
    this.logger.debug("Updating external identity metadata");
    return this.externalIdentityRepository.update(id, { metadata });
  }

  async unlinkIdentity(id: string): Promise<ExternalIdentity> {
    this.logger.debug("Unlinking an external identity");
    return this.externalIdentityRepository.delete(id);
  }

  async findUserIdByProviderIdentity(
    provider: string,
    issuer: string,
    providerUserId: string,
  ): Promise<string | null> {
    const identity = await this.findByProviderAndUserId(
      provider,
      issuer,
      providerUserId,
    );
    return identity?.userId || null;
  }
}
