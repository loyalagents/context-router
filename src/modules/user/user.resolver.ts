import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './models/user.model';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@Resolver(() => User)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  @Mutation(() => User, { description: 'Create a new user' })
  @UseGuards(GqlAuthGuard)
  async createUser(
    @Args('createUserInput') createUserInput: CreateUserInput,
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    return this.userService.create(createUserInput);
  }

  @Query(() => [User], { name: 'users', description: 'Get all users' })
  @UseGuards(GqlAuthGuard)
  async findAll(): Promise<User[]> {
    return this.userService.findAll();
  }

  @Query(() => User, { name: 'user', description: 'Get a user by ID' })
  @UseGuards(GqlAuthGuard)
  async findOne(@Args('id', { type: () => ID }) id: string): Promise<User> {
    return this.userService.findOne(id);
  }

  @Mutation(() => User, { description: 'Update an existing user' })
  @UseGuards(GqlAuthGuard)
  async updateUser(
    @Args('updateUserInput') updateUserInput: UpdateUserInput,
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    return this.userService.update(updateUserInput);
  }

  @Mutation(() => User, { description: 'Delete a user' })
  @UseGuards(GqlAuthGuard)
  async removeUser(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    return this.userService.remove(id);
  }
}
