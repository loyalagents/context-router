import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private keyPrefix(key: string): string {
    return key.substring(0, 8) + '...';
  }

  async validateApiKeyAndUser(
    apiKey: string,
    userId: string,
  ): Promise<{
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  }> {
    const keyHash = this.hashKey(apiKey);

    const apiKeyRecord = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        users: {
          where: { userId },
          include: { user: true },
        },
      },
    });

    if (!apiKeyRecord) {
      this.logger.warn(
        `API key not found (key prefix: "${this.keyPrefix(apiKey)}")`,
      );
      throw new UnauthorizedException('Invalid API key');
    }

    if (!apiKeyRecord.isActive) {
      this.logger.warn(
        `API key is inactive (group: "${apiKeyRecord.groupName}")`,
      );
      throw new UnauthorizedException('API key is inactive');
    }

    const apiKeyUser = apiKeyRecord.users[0];
    if (!apiKeyUser) {
      // Check if user exists at all
      const userExists = await this.prisma.user.findUnique({
        where: { userId },
      });
      if (!userExists) {
        this.logger.warn(`User ${userId} not found in database`);
        throw new UnauthorizedException('User not found');
      }

      this.logger.warn(
        `User ${userId} is not associated with API key group "${apiKeyRecord.groupName}"`,
      );
      throw new UnauthorizedException(
        'User not associated with this API key group',
      );
    }

    return apiKeyUser.user;
  }

  async getUsersByApiKey(
    apiKey: string,
  ): Promise<
    {
      userId: string;
      email: string;
      firstName: string;
      lastName: string;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    const apiKeyRecord = await this.validateApiKey(apiKey);

    const apiKeyUsers = await this.prisma.apiKeyUser.findMany({
      where: { apiKeyId: apiKeyRecord.id },
      include: { user: true },
    });

    return apiKeyUsers.map((aku) => aku.user);
  }

  async validateApiKey(apiKey: string) {
    const keyHash = this.hashKey(apiKey);

    const apiKeyRecord = await this.prisma.apiKey.findUnique({
      where: { keyHash },
    });

    if (!apiKeyRecord) {
      this.logger.warn(
        `API key not found (key prefix: "${this.keyPrefix(apiKey)}")`,
      );
      throw new UnauthorizedException('Invalid API key');
    }

    if (!apiKeyRecord.isActive) {
      this.logger.warn(
        `API key is inactive (group: "${apiKeyRecord.groupName}")`,
      );
      throw new UnauthorizedException('API key is inactive');
    }

    return apiKeyRecord;
  }
}
