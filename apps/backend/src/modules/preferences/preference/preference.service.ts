import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PreferenceRepository } from './preference.repository';
import { LocationService } from '../location/location.service';
import { Preference } from './models/preference.model';
import { CreatePreferenceInput } from './dto/create-preference.input';
import { UpdatePreferenceInput } from './dto/update-preference.input';

@Injectable()
export class PreferenceService {
  private readonly logger = new Logger(PreferenceService.name);

  constructor(
    private preferenceRepository: PreferenceRepository,
    private locationService: LocationService,
  ) {}

  async create(
    userId: string,
    data: CreatePreferenceInput,
  ): Promise<Preference> {
    // If locationId is provided, verify it exists and belongs to user
    if (data.locationId) {
      await this.locationService.findOne(data.locationId, userId);
    }

    this.logger.log(
      `Creating preference for user ${userId}: ${data.category}/${data.key}`,
    );
    return this.preferenceRepository.create(userId, data);
  }

  async findAll(userId: string): Promise<Preference[]> {
    this.logger.log(`Fetching all preferences for user: ${userId}`);
    return this.preferenceRepository.findAll(userId);
  }

  async findOne(preferenceId: string, userId: string): Promise<Preference> {
    const preference = await this.preferenceRepository.findOne(preferenceId);

    if (!preference) {
      throw new NotFoundException(`Preference ${preferenceId} not found`);
    }

    // Verify ownership
    if (preference.userId !== userId) {
      throw new ForbiddenException(
        'You can only access your own preferences',
      );
    }

    return preference;
  }

  async findByCategory(userId: string, category: string): Promise<Preference[]> {
    this.logger.log(
      `Fetching preferences for user ${userId}, category: ${category}`,
    );
    return this.preferenceRepository.findByCategory(userId, category);
  }

  async findByLocation(userId: string, locationId: string): Promise<Preference[]> {
    // Verify location exists and belongs to user
    await this.locationService.findOne(locationId, userId);

    this.logger.log(
      `Fetching preferences for user ${userId}, location: ${locationId}`,
    );
    return this.preferenceRepository.findByLocation(userId, locationId);
  }

  async findGlobalPreferences(userId: string): Promise<Preference[]> {
    this.logger.log(`Fetching global preferences for user: ${userId}`);
    return this.preferenceRepository.findGlobalPreferences(userId);
  }

  async update(
    preferenceId: string,
    userId: string,
    data: UpdatePreferenceInput,
  ): Promise<Preference> {
    // Verify ownership first
    await this.findOne(preferenceId, userId);

    // If updating locationId, verify new location exists and belongs to user
    if (data.locationId) {
      await this.locationService.findOne(data.locationId, userId);
    }

    this.logger.log(`Updating preference ${preferenceId} for user: ${userId}`);
    return this.preferenceRepository.update(preferenceId, data);
  }

  async delete(preferenceId: string, userId: string): Promise<Preference> {
    // Verify ownership first
    await this.findOne(preferenceId, userId);

    this.logger.log(`Deleting preference ${preferenceId} for user: ${userId}`);
    return this.preferenceRepository.delete(preferenceId);
  }

  async count(userId: string): Promise<number> {
    return this.preferenceRepository.count(userId);
  }
}
