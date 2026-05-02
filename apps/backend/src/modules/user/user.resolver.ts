import { Resolver, Query, Args, ID } from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './models/user.model';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@Resolver(() => User)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  @Query(() => User, { name: 'user', description: 'Get a user by ID' })
  @UseGuards(GqlAuthGuard)
  async findOne(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    // Users can only view their own account identity.
    if (currentUser.userId !== id) {
      throw new ForbiddenException('You can only view your own account');
    }

    return this.userService.findOne(id);
  }

  // TODO: Add admin role support to enable the following operations:
  // - findAll() query for admins to list all users
  // - removeUser() mutation for admins to delete users
  // - createUser() mutation for admins to manually create users (users are auto-created via Auth0 by default)
  // See docs/AUTHORIZATION_TODO.md for implementation plan
}
