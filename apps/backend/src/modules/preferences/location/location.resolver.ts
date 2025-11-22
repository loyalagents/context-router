import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { LocationService } from './location.service';
import { Location, LocationType } from './models/location.model';
import { CreateLocationInput } from './dto/create-location.input';
import { UpdateLocationInput } from './dto/update-location.input';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/user/models/user.model';

@Resolver(() => Location)
@UseGuards(GqlAuthGuard)
export class LocationResolver {
  constructor(private locationService: LocationService) {}

  @Mutation(() => Location)
  async createLocation(
    @Args('data') data: CreateLocationInput,
    @CurrentUser() user: User,
  ): Promise<Location> {
    return this.locationService.create(user.userId, data);
  }

  @Query(() => [Location])
  async locations(@CurrentUser() user: User): Promise<Location[]> {
    return this.locationService.findAll(user.userId);
  }

  @Query(() => Location)
  async location(
    @Args('locationId') locationId: string,
    @CurrentUser() user: User,
  ): Promise<Location> {
    return this.locationService.findOne(locationId, user.userId);
  }

  @Query(() => [Location])
  async locationsByType(
    @Args('type', { type: () => LocationType }) type: LocationType,
    @CurrentUser() user: User,
  ): Promise<Location[]> {
    return this.locationService.findByUserIdAndType(user.userId, type);
  }

  @Mutation(() => Location)
  async updateLocation(
    @Args('locationId') locationId: string,
    @Args('data') data: UpdateLocationInput,
    @CurrentUser() user: User,
  ): Promise<Location> {
    return this.locationService.update(locationId, user.userId, data);
  }

  @Mutation(() => Location)
  async deleteLocation(
    @Args('locationId') locationId: string,
    @CurrentUser() user: User,
  ): Promise<Location> {
    return this.locationService.delete(locationId, user.userId);
  }
}
