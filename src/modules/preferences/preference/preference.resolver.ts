import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PreferenceService } from './preference.service';
import { Preference } from './models/preference.model';
import { CreatePreferenceInput } from './dto/create-preference.input';
import { UpdatePreferenceInput } from './dto/update-preference.input';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/user/models/user.model';

@Resolver(() => Preference)
@UseGuards(GqlAuthGuard)
export class PreferenceResolver {
  constructor(private preferenceService: PreferenceService) {}

  @Mutation(() => Preference)
  async createPreference(
    @Args('data') data: CreatePreferenceInput,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    return this.preferenceService.create(user.userId, data);
  }

  @Query(() => [Preference])
  async preferences(@CurrentUser() user: User): Promise<Preference[]> {
    return this.preferenceService.findAll(user.userId);
  }

  @Query(() => Preference)
  async preference(
    @Args('preferenceId') preferenceId: string,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    return this.preferenceService.findOne(preferenceId, user.userId);
  }

  @Query(() => [Preference])
  async preferencesByCategory(
    @Args('category') category: string,
    @CurrentUser() user: User,
  ): Promise<Preference[]> {
    return this.preferenceService.findByCategory(user.userId, category);
  }

  @Query(() => [Preference])
  async preferencesByLocation(
    @Args('locationId') locationId: string,
    @CurrentUser() user: User,
  ): Promise<Preference[]> {
    return this.preferenceService.findByLocation(user.userId, locationId);
  }

  @Query(() => [Preference])
  async globalPreferences(@CurrentUser() user: User): Promise<Preference[]> {
    return this.preferenceService.findGlobalPreferences(user.userId);
  }

  @Mutation(() => Preference)
  async updatePreference(
    @Args('preferenceId') preferenceId: string,
    @Args('data') data: UpdatePreferenceInput,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    return this.preferenceService.update(preferenceId, user.userId, data);
  }

  @Mutation(() => Preference)
  async deletePreference(
    @Args('preferenceId') preferenceId: string,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    return this.preferenceService.delete(preferenceId, user.userId);
  }
}
