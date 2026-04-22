import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { User } from '@modules/user/models/user.model';
import { McpAccessHistoryInput } from './dto/mcp-access-history.input';
import { McpAccessHistoryPageModel } from './models/mcp-access-history-page.model';
import { McpAccessLogQueryService } from './mcp-access-log-query.service';

@Resolver(() => McpAccessHistoryPageModel)
@UseGuards(GqlAuthGuard)
export class McpAccessLogResolver {
  constructor(
    private readonly mcpAccessLogQueryService: McpAccessLogQueryService,
  ) {}

  @Query(() => McpAccessHistoryPageModel, {
    description:
      'Get MCP access history for the current user with cursor pagination and filters.',
  })
  async mcpAccessHistory(
    @CurrentUser() user: User,
    @Args('input') input: McpAccessHistoryInput,
  ): Promise<McpAccessHistoryPageModel> {
    return this.mcpAccessLogQueryService.getHistory(user.userId, input);
  }
}
