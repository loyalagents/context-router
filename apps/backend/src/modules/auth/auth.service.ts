import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@infrastructure/prisma/generated-client';
import type { User } from "@/domains/shared/storage/storage-types";
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { UserService } from '@modules/user/user.service';
import {
  createM2MCompatibilityEmail,
  createM2MCompatibilityPrincipalId,
  type M2MCompatibilityIdentityKey,
} from './principal-identity';

const M2M_SERIALIZABLE_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
  ) {}

  async getCurrentUser(userId: string): Promise<User> {
    return this.userService.findOne(userId);
  }

  async findOrCreateM2MUser(
    identityKey: M2MCompatibilityIdentityKey,
  ): Promise<User> {
    const userId = createM2MCompatibilityPrincipalId(identityKey);
    const email = createM2MCompatibilityEmail(identityKey);
    this.logger.debug('Resolving hosted M2M compatibility principal');

    for (let attempt = 1; attempt <= M2M_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      let result: { user: User; identityCount: number };
      try {
        result = await this.prisma.$transaction(
          async (transaction) => {
            const user = await transaction.user.upsert({
              where: { userId },
              create: { userId, email },
              update: {},
            });
            const identityCount = await transaction.externalIdentity.count({
              where: { userId },
            });
            return { user, identityCount };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt < M2M_SERIALIZABLE_ATTEMPTS &&
          this.isRetryableConflict(error)
        ) {
          continue;
        }
        throw new Error('Hosted M2M compatibility principal failed');
      }

      if (
        result.user.userId !== userId ||
        result.user.email !== email ||
        result.identityCount !== 0
      ) {
        throw new Error('Hosted M2M compatibility principal conflict');
      }
      return result.user;
    }

    throw new Error('Hosted M2M compatibility principal failed');
  }

  private isRetryableConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
      meta?: { code?: string };
    };
    return (
      candidate.code === 'P2002' ||
      candidate.code === 'P2034' ||
      candidate.code === '40001' ||
      candidate.cause?.code === '40001' ||
      candidate.meta?.code === '40001'
    );
  }
}
