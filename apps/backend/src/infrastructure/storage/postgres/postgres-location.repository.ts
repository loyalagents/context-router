import {
  LocationRepository,
  type CreateLocationData,
  type UpdateLocationData,
} from "@/modules/preferences/location/location.repository";
import { postgresClient } from "./postgres-client";
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@infrastructure/prisma/generated-client";
import type {
  Location,
  LocationType,
} from "@/domains/shared/storage/storage-types";

@Injectable()
export class PostgresLocationRepository implements LocationRepository {
  private readonly logger = new Logger(PostgresLocationRepository.name);

  constructor(private prisma: Prisma.TransactionClient) {
    this.prisma = postgresClient(this.prisma);
  }

  async create(userId: string, data: CreateLocationData): Promise<Location> {
    this.logger.log("Creating a location row");
    return this.prisma.location.create({
      data: {
        userId,
        type: data.type,
        label: data.label,
        address: data.address,
      },
    });
  }

  /**
   * Upsert location by userId + type + label.
   * If a location with the same type and label exists, update it.
   * Otherwise, create a new one.
   *
   * This is read-then-write; concurrent first writes may create duplicates.
   * Useful for "update my HOME address" type operations.
   */
  async upsert(userId: string, data: CreateLocationData): Promise<Location> {
    this.logger.log("Upserting a location row");

    // Find existing location with same type and label
    const existing = await this.prisma.location.findFirst({
      where: {
        userId,
        type: data.type,
        label: data.label,
      },
    });

    if (existing) {
      // Update existing location
      return this.prisma.location.update({
        where: { locationId: existing.locationId },
        data: {
          address: data.address,
          // Type and label stay the same since we matched on them
        },
      });
    }

    // Create new location
    return this.create(userId, data);
  }

  async findAll(userId: string): Promise<Location[]> {
    this.logger.log("Fetching location rows");
    return this.prisma.location.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(locationId: string): Promise<Location | null> {
    this.logger.log("Fetching one location row");
    return this.prisma.location.findUnique({
      where: { locationId },
    });
  }

  async findByUserIdAndType(
    userId: string,
    type: LocationType,
  ): Promise<Location[]> {
    this.logger.log("Fetching location rows by type");
    return this.prisma.location.findMany({
      where: {
        userId,
        type: type,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(
    locationId: string,
    data: UpdateLocationData,
  ): Promise<Location> {
    this.logger.log("Updating a location row");
    return this.prisma.location.update({
      where: { locationId },
      data: {
        ...(data.type && { type: data.type }),
        ...(data.label && { label: data.label }),
        ...(data.address && { address: data.address }),
      },
    });
  }

  async delete(locationId: string): Promise<Location> {
    this.logger.log("Deleting a location row");
    return this.prisma.location.delete({
      where: { locationId },
    });
  }

  async count(userId: string): Promise<number> {
    return this.prisma.location.count({
      where: { userId },
    });
  }
}
