import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { LocationRepository } from './location.repository';
import { Location, LocationType } from './models/location.model';
import { CreateLocationInput } from './dto/create-location.input';
import { UpdateLocationInput } from './dto/update-location.input';

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(private locationRepository: LocationRepository) {}

  async create(userId: string, data: CreateLocationInput): Promise<Location> {
    this.logger.log(`Creating location for user ${userId}: ${data.type}`);
    return this.locationRepository.create(userId, data);
  }

  async findAll(userId: string): Promise<Location[]> {
    this.logger.log(`Fetching all locations for user: ${userId}`);
    return this.locationRepository.findAll(userId);
  }

  async findOne(locationId: string, userId: string): Promise<Location> {
    const location = await this.locationRepository.findOne(locationId);

    if (!location) {
      throw new NotFoundException(`Location ${locationId} not found`);
    }

    // Verify ownership
    if (location.userId !== userId) {
      throw new ForbiddenException('You can only access your own locations');
    }

    return location;
  }

  async findByUserIdAndType(
    userId: string,
    type: LocationType,
  ): Promise<Location[]> {
    this.logger.log(`Fetching ${type} locations for user: ${userId}`);
    return this.locationRepository.findByUserIdAndType(userId, type);
  }

  async update(
    locationId: string,
    userId: string,
    data: UpdateLocationInput,
  ): Promise<Location> {
    // Verify ownership first
    await this.findOne(locationId, userId);

    this.logger.log(`Updating location ${locationId} for user: ${userId}`);
    return this.locationRepository.update(locationId, data);
  }

  async delete(locationId: string, userId: string): Promise<Location> {
    // Verify ownership first
    await this.findOne(locationId, userId);

    this.logger.log(`Deleting location ${locationId} for user: ${userId}`);
    return this.locationRepository.delete(locationId);
  }

  async count(userId: string): Promise<number> {
    return this.locationRepository.count(userId);
  }
}
