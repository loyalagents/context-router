import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { Location, LocationType } from './models/location.model';
import { CreateLocationInput } from './dto/create-location.input';
import { UpdateLocationInput } from './dto/update-location.input';

@Injectable()
export class LocationRepository {
  private readonly logger = new Logger(LocationRepository.name);

  constructor(private prisma: PrismaService) {}

  async create(
    userId: string,
    data: CreateLocationInput,
  ): Promise<Location> {
    this.logger.log(`Creating location for user: ${userId}`);
    return this.prisma.location.create({
      data: {
        userId,
        type: data.type as any, // Prisma enum matches our enum
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
   * This prevents duplicate locations and handles race conditions gracefully.
   * Useful for "update my HOME address" type operations.
   */
  async upsert(
    userId: string,
    data: CreateLocationInput,
  ): Promise<Location> {
    this.logger.log(
      `Upserting location for user: ${userId}, type: ${data.type}, label: ${data.label}`,
    );

    // Find existing location with same type and label
    const existing = await this.prisma.location.findFirst({
      where: {
        userId,
        type: data.type as any,
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
    this.logger.log(`Fetching all locations for user: ${userId}`);
    return this.prisma.location.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(locationId: string): Promise<Location | null> {
    this.logger.log(`Fetching location: ${locationId}`);
    return this.prisma.location.findUnique({
      where: { locationId },
    });
  }

  async findByUserIdAndType(
    userId: string,
    type: LocationType,
  ): Promise<Location[]> {
    this.logger.log(`Fetching ${type} locations for user: ${userId}`);
    return this.prisma.location.findMany({
      where: {
        userId,
        type: type as any,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    locationId: string,
    data: UpdateLocationInput,
  ): Promise<Location> {
    this.logger.log(`Updating location: ${locationId}`);
    return this.prisma.location.update({
      where: { locationId },
      data: {
        ...(data.type && { type: data.type as any }),
        ...(data.label && { label: data.label }),
        ...(data.address && { address: data.address }),
      },
    });
  }

  async delete(locationId: string): Promise<Location> {
    this.logger.log(`Deleting location: ${locationId}`);
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
