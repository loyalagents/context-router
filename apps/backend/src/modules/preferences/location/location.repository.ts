import type {
  Location,
  LocationType,
} from "@/domains/shared/storage/storage-types";
export interface CreateLocationData {
  type: LocationType;
  label: string;
  address: string;
}
export type UpdateLocationData = Partial<CreateLocationData>;
/** Application-owned persistence behavior, independent of database and transport types. */
export abstract class LocationRepository {
  abstract create(userId: string, data: CreateLocationData): Promise<Location>;
  abstract upsert(userId: string, data: CreateLocationData): Promise<Location>;
  abstract findAll(userId: string): Promise<Location[]>;
  abstract findOne(locationId: string): Promise<Location | null>;
  abstract findByUserIdAndType(
    userId: string,
    type: LocationType,
  ): Promise<Location[]>;
  abstract update(
    locationId: string,
    data: UpdateLocationData,
  ): Promise<Location>;
  abstract delete(locationId: string): Promise<Location>;
  abstract count(userId: string): Promise<number>;
}
