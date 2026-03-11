import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { User } from '@modules/user/models/user.model';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiKeyService } from './api-key.service';
import { UserService } from '@modules/user/user.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreateGroupUserInput } from './dto/create-group-user.input';

@Resolver()
export class AuthResolver {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
  ) {}

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

  @Mutation(() => User, {
    description: 'Create a new user and associate them with an API key group',
  })
  async createGroupUser(
    @Args('input') input: CreateGroupUserInput,
  ): Promise<User> {
    const apiKeyRecord = await this.apiKeyService.validateApiKey(input.apiKey);
    const user = await this.userService.create({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
    });
    await this.prisma.apiKeyUser.create({
      data: {
        apiKeyId: apiKeyRecord.id,
        userId: user.userId,
        createdAt: new Date(),
      },
    });
    return user;
  }
}
