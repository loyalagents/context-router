import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { Preference } from './models/preference.model';
import { CreatePreferenceInput } from './dto/create-preference.input';
import { UpdatePreferenceInput } from './dto/update-preference.input';

@Injectable()
export class PreferenceRepository {
  private readonly logger = new Logger(PreferenceRepository.name);

  constructor(private prisma: PrismaService) {}

  async create(
    userId: string,
    data: CreatePreferenceInput,
  ): Promise<Preference> {
    this.logger.log(
      `Creating preference for user: ${userId}, category: ${data.category}`,
    );
    return this.prisma.preference.create({
      data: {
        userId,
        locationId: data.locationId,
        category: data.category,
        key: data.key,
        value: data.value,
      },
    });
  }

  async findAll(userId: string): Promise<Preference[]> {
    this.logger.log(`Fetching all preferences for user: ${userId}`);
    return this.prisma.preference.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(preferenceId: string): Promise<Preference | null> {
    this.logger.log(`Fetching preference: ${preferenceId}`);
    return this.prisma.preference.findUnique({
      where: { preferenceId },
    });
  }

  async findByCategory(
    userId: string,
    category: string,
  ): Promise<Preference[]> {
    this.logger.log(
      `Fetching preferences for user: ${userId}, category: ${category}`,
    );
    return this.prisma.preference.findMany({
      where: {
        userId,
        category,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByLocation(
    userId: string,
    locationId: string,
  ): Promise<Preference[]> {
    this.logger.log(
      `Fetching preferences for user: ${userId}, location: ${locationId}`,
    );
    return this.prisma.preference.findMany({
      where: {
        userId,
        locationId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findGlobalPreferences(userId: string): Promise<Preference[]> {
    this.logger.log(`Fetching global preferences for user: ${userId}`);
    return this.prisma.preference.findMany({
      where: {
        userId,
        locationId: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    preferenceId: string,
    data: UpdatePreferenceInput,
  ): Promise<Preference> {
    this.logger.log(`Updating preference: ${preferenceId}`);
    return this.prisma.preference.update({
      where: { preferenceId },
      data: {
        ...(data.locationId !== undefined && { locationId: data.locationId }),
        ...(data.category && { category: data.category }),
        ...(data.key && { key: data.key }),
        ...(data.value !== undefined && { value: data.value }),
      },
    });
  }

  async delete(preferenceId: string): Promise<Preference> {
    this.logger.log(`Deleting preference: ${preferenceId}`);
    return this.prisma.preference.delete({
      where: { preferenceId },
    });
  }

  async count(userId: string): Promise<number> {
    return this.prisma.preference.count({
      where: { userId },
    });
  }
}
