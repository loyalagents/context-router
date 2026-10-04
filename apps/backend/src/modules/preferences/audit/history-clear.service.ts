import { BadRequestException, Injectable } from '@nestjs/common';
import { Field, Int, ObjectType } from '@nestjs/graphql';
import { StorageUnitOfWork } from '@/domains/shared/storage/storage-unit-of-work';
import { StorageConflictError } from '@/domains/shared/storage/storage-errors';

@ObjectType()
export class ClearMyHistoryResult {
  @Field(() => String, {
    description:
      'CLEARED, ROLLED_BACK, or UNCERTAIN. Never automatically retry.',
  })
  status: 'CLEARED' | 'ROLLED_BACK' | 'UNCERTAIN';
  @Field(() => Int, { nullable: true })
  preferenceAuditEventsDeleted?: number;
  @Field(() => Int, { nullable: true })
  mcpAccessEventsDeleted?: number;
}

@Injectable()
export class HistoryClearService {
  constructor(private readonly unitOfWork: StorageUnitOfWork) {}
  async clear(
    userId: string,
    confirmation: string,
  ): Promise<ClearMyHistoryResult> {
    if (confirmation !== 'CLEAR HISTORY')
      throw new BadRequestException('Confirm CLEAR HISTORY');
    try {
      return await this.unitOfWork.serializable(async ({ reset }) => {
        const preferenceAuditEventsDeleted =
          await reset.deleteAuditEvents(userId);
        const mcpAccessEventsDeleted = await reset.deleteAccessEvents(userId);
        return {
          status: 'CLEARED' as const,
          preferenceAuditEventsDeleted,
          mcpAccessEventsDeleted,
        };
      });
    } catch (error) {
      // Provider uncertainty is deliberately not treated as an acknowledged rollback.
      return {
        status:
          error instanceof StorageConflictError &&
          error.kind === 'serialization'
            ? 'ROLLED_BACK'
            : 'UNCERTAIN',
      };
    }
  }
}
