import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './models/user.model';
import { UpdateUserInput } from './dto/update-user.input';
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
    // Users can only view their own profile
    if (currentUser.userId !== id) {
      throw new ForbiddenException('You can only view your own profile');
    }

    return this.userService.findOne(id);
  }

  @Mutation(() => User, { description: 'Update an existing user' })
  @UseGuards(GqlAuthGuard)
  async updateUser(
    @Args('updateUserInput') updateUserInput: UpdateUserInput,
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    // Users can only update their own profile
    if (currentUser.userId !== updateUserInput.userId) {
      throw new ForbiddenException('You can only update your own profile');
    }

    return this.userService.update(updateUserInput);
  }

  // TODO: Add admin role support to enable the following operations:
  // - findAll() query for admins to list all users
  // - removeUser() mutation for admins to delete users
  // - createUser() mutation for admins to manually create users (users are auto-created via Auth0 by default)
  // See docs/AUTHORIZATION_TODO.md for implementation plan
}
