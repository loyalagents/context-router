import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { User } from '@modules/user/models/user.model';
import { ResetMemoryMode } from './models/reset-memory-mode.enum';
import { ResetMyMemoryPayload } from './models/reset-my-memory-payload.model';
import { UserDataResetService } from './user-data-reset.service';

@Resolver(() => ResetMyMemoryPayload)
@UseGuards(GqlAuthGuard)
export class ResetResolver {
  constructor(private readonly resetService: UserDataResetService) {}

  @Mutation(() => ResetMyMemoryPayload, {
    description: 'Reset current-user preference/demo data.',
  })
  async resetMyMemory(
    @CurrentUser() user: User,
    @Args('mode', { type: () => ResetMemoryMode }) mode: ResetMemoryMode,
  ): Promise<ResetMyMemoryPayload> {
    return this.resetService.resetMyMemory(user.userId, mode);
  }
}
