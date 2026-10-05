import { Args, Query, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { User } from '@modules/user/models/user.model';
import { PreferenceAuditHistoryInput } from './dto/preference-audit-history.input';
import { PreferenceAuditHistoryPageModel } from './models/preference-audit-history-page.model';
import { PreferenceAuditQueryService } from './preference-audit-query.service';
import { HistoryClearService, ClearMyHistoryResult } from './history-clear.service';

@Resolver(() => PreferenceAuditHistoryPageModel)
@UseGuards(GqlAuthGuard)
export class PreferenceAuditResolver {
  constructor(
    private readonly preferenceAuditQueryService: PreferenceAuditQueryService,
    private readonly historyClearService: HistoryClearService,
  ) {}

  @Mutation(() => ClearMyHistoryResult, { description: 'Atomically clear both retained history streams for the current user, preserving live memory and authority. Requires CLEAR HISTORY.' })
  clearMyHistory(@CurrentUser() user: User, @Args('confirmation') confirmation: string): Promise<ClearMyHistoryResult> {
    return this.historyClearService.clear(user.userId, confirmation);
  }

  @Query(() => PreferenceAuditHistoryPageModel, {
    description: 'Get audit history for the current user with cursor pagination and filters.',
  })
  async preferenceAuditHistory(
    @CurrentUser() user: User,
    @Args('input') input: PreferenceAuditHistoryInput,
  ): Promise<PreferenceAuditHistoryPageModel> {
    return this.preferenceAuditQueryService.getHistory(user.userId, input);
  }
}
