import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/user/models/user.model';
import { GrantAction } from '@infrastructure/prisma/generated-client';
import { SetPermissionGrantInput } from './dto/set-permission-grant.input';
import { PermissionGrantModel } from './models/permission-grant.model';
import { PermissionGrantRepository } from './permission-grant.repository';
import { PermissionGrantService } from './permission-grant.service';

@Resolver(() => PermissionGrantModel)
@UseGuards(ApiKeyGuard)
export class PermissionGrantResolver {
  constructor(
    private readonly repository: PermissionGrantRepository,
    private readonly permissionGrantService: PermissionGrantService,
  ) {}

  @Query(() => [PermissionGrantModel], {
    description: 'List the current user’s permission grants.',
  })
  async myPermissionGrants(
    @CurrentUser() user: User,
    @Args('clientKey', { nullable: true }) clientKey?: string,
  ): Promise<PermissionGrantModel[]> {
    if (clientKey) {
      this.permissionGrantService.assertManagedClientKey(clientKey);
      return this.repository.findByUserAndClient(
        user.userId,
        clientKey,
      ) as Promise<PermissionGrantModel[]>;
    }

    return this.repository.findByUser(user.userId) as Promise<
      PermissionGrantModel[]
    >;
  }

  @Mutation(() => PermissionGrantModel, {
    description: 'Create or update a permission grant for the current user.',
  })
  async setPermissionGrant(
    @CurrentUser() user: User,
    @Args('input') input: SetPermissionGrantInput,
  ): Promise<PermissionGrantModel> {
    this.permissionGrantService.assertManagedClientKey(input.clientKey);
    this.permissionGrantService.assertValidTarget(input.target);

    return this.repository.upsert(
      user.userId,
      input.clientKey,
      input.target,
      input.action,
      input.effect,
    ) as Promise<PermissionGrantModel>;
  }

  @Mutation(() => Boolean, {
    description: 'Remove a permission grant for the current user.',
  })
  async removePermissionGrant(
    @CurrentUser() user: User,
    @Args('clientKey') clientKey: string,
    @Args('target') target: string,
    @Args('action', { type: () => GrantAction }) action: GrantAction,
  ): Promise<boolean> {
    this.permissionGrantService.assertManagedClientKey(clientKey);
    this.permissionGrantService.assertValidTarget(target);

    await this.repository.remove(user.userId, clientKey, target, action);
    return true;
  }
}
