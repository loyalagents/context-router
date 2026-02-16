import { Resolver, Query } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { User } from '@modules/user/models/user.model';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@Resolver()
export class AuthResolver {
  @Query(() => User, { description: 'Get current authenticated user' })
  @UseGuards(ApiKeyGuard)
  async me(@CurrentUser() user: User): Promise<User> {
    return user;
  }
}
