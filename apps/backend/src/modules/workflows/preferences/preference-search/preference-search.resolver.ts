import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/user/models/user.model';
import { SmartPreferenceSearchInput } from './dto/smart-preference-search.input';
import { SmartPreferenceSearchResult } from './models/smart-preference-search-result.model';
import { PreferenceSearchWorkflow } from './preference-search.workflow';

@Resolver()
@UseGuards(GqlAuthGuard)
export class PreferenceSearchResolver {
  constructor(
    private readonly workflow: PreferenceSearchWorkflow,
    private readonly configService: ConfigService,
  ) {}

  @Query(() => SmartPreferenceSearchResult, {
    description:
      'Map a natural-language task to relevant preference slugs, then return matching stored preferences for the authenticated user.',
  })
  async smartSearchPreferences(
    @CurrentUser() user: User,
    @Args('input') input: SmartPreferenceSearchInput,
  ): Promise<SmartPreferenceSearchResult> {
    const maxResults = this.configService.get<number>(
      'mcp.tools.preferences.maxSearchResults',
    );

    const result = await this.workflow.run({
      userId: user.userId,
      clientKey: '__dashboard__',
      filterAccessibleSlugs: async (slugs) => slugs,
      naturalLanguageQuery: input.query,
      locationId: input.locationId,
      includeSuggestions: input.includeSuggestions,
      maxResults,
    });

    return result as SmartPreferenceSearchResult;
  }
}
