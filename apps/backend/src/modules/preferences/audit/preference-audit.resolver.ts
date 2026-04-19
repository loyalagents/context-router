import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { User } from '@modules/user/models/user.model';
import { PreferenceAuditHistoryInput } from './dto/preference-audit-history.input';
import { PreferenceAuditHistoryPageModel } from './models/preference-audit-history-page.model';
import { PreferenceAuditQueryService } from './preference-audit-query.service';

@Resolver(() => PreferenceAuditHistoryPageModel)
@UseGuards(GqlAuthGuard)
export class PreferenceAuditResolver {
  constructor(
    private readonly preferenceAuditQueryService: PreferenceAuditQueryService,
  ) {}

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
