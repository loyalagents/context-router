import { Resolver, Query, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { User } from '@modules/user/models/user.model';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiKeyService } from './api-key.service';

@Resolver()
export class AuthResolver {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Query(() => User, { description: 'Get current authenticated user' })
  @UseGuards(ApiKeyGuard)
  async me(@CurrentUser() user: User): Promise<User> {
    return user;
  }

  @Query(() => [User], {
    name: 'groupUsers',
    description: 'Get users associated with an API key group',
  })
  async groupUsers(
    @Args('apiKey', { type: () => String }) apiKey: string,
  ): Promise<User[]> {
    return this.apiKeyService.getUsersByApiKey(apiKey);
  }
}
