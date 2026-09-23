import { ObjectType, Field, ID, registerEnumType } from "@nestjs/graphql";
import { LocationType as StoredLocationType } from "@/domains/shared/storage/storage-types";

// Re-export the application-owned enum for transport registration
export const LocationType = StoredLocationType;
export type LocationType = StoredLocationType;

registerEnumType(LocationType, {
  name: "LocationType",
  description: "Type of location",
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
