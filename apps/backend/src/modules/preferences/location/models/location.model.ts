import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { LocationType as PrismaLocationType } from '@prisma/client';

// Re-export Prisma's enum for consistency
export const LocationType = PrismaLocationType;
export type LocationType = PrismaLocationType;

registerEnumType(LocationType, {
  name: 'LocationType',
  description: 'Type of location',
});

@ObjectType()
export class Location {
  @Field(() => ID)
  locationId: string;

  @Field()
  userId: string;

  @Field(() => LocationType)
  type: LocationType;

  @Field()
  label: string;

  @Field()
  address: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
