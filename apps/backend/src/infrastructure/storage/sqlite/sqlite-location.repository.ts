import type {
  LocationRepository,
  CreateLocationData,
  UpdateLocationData,
} from "../../../modules/preferences/location/location.repository";
import type {
  Location,
  LocationType,
} from "../../../domains/shared/storage/storage-types";
import {
  SqliteAccess,
  decode,
  insert,
  update,
  remove,
  timestamped,
} from "./sqlite-records";
export class SqliteLocationRepository
  extends SqliteAccess
  implements LocationRepository
{
  create(userId: string, data: CreateLocationData): Promise<Location> {
    return this.call((c) =>
      insert<Location>(
        c,
        "locations",
        timestamped(
          {
            user_id: userId,
            type: data.type,
            label: data.label,
            address: data.address,
          },
          "location_id",
        ),
      ),
    );
  }
  upsert(userId: string, data: CreateLocationData): Promise<Location> {
    return this.mutate((c) => {
      const existing = c.get(
        "SELECT location_id FROM locations WHERE user_id=? AND type=? AND label=? LIMIT 1",
        [userId, data.type, data.label],
      );
      return existing
        ? update<Location>(
            c,
            "locations",
            "location_id",
            existing.location_id,
            { address: data.address },
          )
        : insert<Location>(
            c,
            "locations",
            timestamped(
              {
                user_id: userId,
                type: data.type,
                label: data.label,
                address: data.address,
              },
              "location_id",
            ),
          );
    });
  }
  findAll(userId: string): Promise<Location[]> {
    return this.call((c) =>
      c
        .all(
          "SELECT * FROM locations WHERE user_id=? ORDER BY created_at DESC",
          [userId],
        )
        .map((row) => decode<Location>(row)!),
    );
  }
  findOne(locationId: string): Promise<Location | null> {
    return this.call((c) =>
      decode<Location>(
        c.get("SELECT * FROM locations WHERE location_id=?", [locationId]),
      ),
    );
  }
  findByUserIdAndType(userId: string, type: LocationType): Promise<Location[]> {
    return this.call((c) =>
      c
        .all(
          "SELECT * FROM locations WHERE user_id=? AND type=? ORDER BY created_at DESC",
          [userId, type],
        )
        .map((row) => decode<Location>(row)!),
    );
  }
  update(locationId: string, data: UpdateLocationData): Promise<Location> {
    return this.call((c) =>
      update<Location>(c, "locations", "location_id", locationId, {
        ...(data.type ? { type: data.type } : {}),
        ...(data.label ? { label: data.label } : {}),
        ...(data.address ? { address: data.address } : {}),
      }),
    );
  }
  delete(locationId: string): Promise<Location> {
    return this.call((c) =>
      remove<Location>(c, "locations", "location_id", locationId),
    );
  }
  count(userId: string): Promise<number> {
    return this.call(
      (c) =>
        c.get("SELECT count(*) n FROM locations WHERE user_id=?", [userId]).n,
    );
  }
}
