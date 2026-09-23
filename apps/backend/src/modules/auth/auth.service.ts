import { Injectable, Logger } from '@nestjs/common';
import type { User } from "@/domains/shared/storage/storage-types";
import { StorageUnitOfWork } from '@/domains/shared/storage/storage-unit-of-work';
import { StorageConflictError } from '@/domains/shared/storage/storage-errors';
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
    private readonly unitOfWork: StorageUnitOfWork,
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
        result = await this.unitOfWork.serializable(async ({ identity }) => {
          const user = await identity.upsertM2MPrincipal(userId, email);
          const identityCount = await identity.countBindings(userId);
          return { user, identityCount };
        });
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
    return error instanceof StorageConflictError;
  }
}
