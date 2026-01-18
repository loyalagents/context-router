import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  Preference as PrismaPreference,
  PreferenceStatus,
  SourceType,
} from '@prisma/client';
import { getDefinition } from '@config/preferences.catalog';

// Type for the enriched preference with catalog data
export interface EnrichedPreference extends PrismaPreference {
  category?: string;
  description?: string;
}

@Injectable()
export class PreferenceRepository {
  private readonly logger = new Logger(PreferenceRepository.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Enriches a preference with category and description from the catalog.
   */
  private enrichWithCatalog(pref: PrismaPreference): EnrichedPreference {
    const def = getDefinition(pref.slug);
    return {
      ...pref,
      category: def?.category,
      description: def?.description,
    };
  }

  /**
   * Enriches multiple preferences with catalog data.
   */
  private enrichManyWithCatalog(
    prefs: PrismaPreference[],
  ): EnrichedPreference[] {
    return prefs.map((p) => this.enrichWithCatalog(p));
  }

  /**
   * Upserts an ACTIVE preference for a user.
   * Creates if doesn't exist, updates if it does.
   */
  async upsertActive(
    userId: string,
    slug: string,
    value: any,
    locationId?: string | null,
  ): Promise<EnrichedPreference> {
    this.logger.log(
      `Upserting ACTIVE preference for user: ${userId}, slug: ${slug}`,
    );

    const normalizedLocationId = locationId ?? null;

    // Find existing ACTIVE preference
    const existing = await this.prisma.preference.findFirst({
      where: {
        userId,
        locationId: normalizedLocationId,
        slug,
        status: PreferenceStatus.ACTIVE,
      },
    });

    let result: PrismaPreference;

    if (existing) {
      result = await this.prisma.preference.update({
        where: { id: existing.id },
        data: {
          value,
          sourceType: SourceType.USER,
        },
      });
    } else {
      result = await this.prisma.preference.create({
        data: {
          userId,
          locationId: normalizedLocationId,
          slug,
          value,
          status: PreferenceStatus.ACTIVE,
          sourceType: SourceType.USER,
        },
      });
    }

    return this.enrichWithCatalog(result);
  }

  /**
   * Upserts a SUGGESTED preference for a user.
   * Creates if doesn't exist, updates if it does (last write wins).
   */
  async upsertSuggested(
    userId: string,
    slug: string,
    value: any,
    confidence: number,
    locationId?: string | null,
    evidence?: any,
  ): Promise<EnrichedPreference> {
    this.logger.log(
      `Upserting SUGGESTED preference for user: ${userId}, slug: ${slug}`,
    );

    const normalizedLocationId = locationId ?? null;

    // Find existing SUGGESTED preference
    const existing = await this.prisma.preference.findFirst({
      where: {
        userId,
        locationId: normalizedLocationId,
        slug,
        status: PreferenceStatus.SUGGESTED,
      },
    });

    let result: PrismaPreference;

    if (existing) {
      result = await this.prisma.preference.update({
        where: { id: existing.id },
        data: {
          value,
          confidence,
          evidence,
          sourceType: SourceType.INFERRED,
        },
      });
    } else {
      result = await this.prisma.preference.create({
        data: {
          userId,
          locationId: normalizedLocationId,
          slug,
          value,
          status: PreferenceStatus.SUGGESTED,
          sourceType: SourceType.INFERRED,
          confidence,
          evidence,
        },
      });
    }

    return this.enrichWithCatalog(result);
  }

  /**
   * Checks if a REJECTED row exists for the given user/location/slug.
   */
  async hasRejected(
    userId: string,
    slug: string,
    locationId?: string | null,
  ): Promise<boolean> {
    const count = await this.prisma.preference.count({
      where: {
        userId,
        locationId: locationId ?? null,
        slug,
        status: PreferenceStatus.REJECTED,
      },
    });
    return count > 0;
  }

  /**
   * Upserts a REJECTED preference for a user.
   */
  async upsertRejected(
    userId: string,
    slug: string,
    value: any,
    locationId?: string | null,
  ): Promise<EnrichedPreference> {
    this.logger.log(
      `Upserting REJECTED preference for user: ${userId}, slug: ${slug}`,
    );

    const normalizedLocationId = locationId ?? null;

    const existing = await this.prisma.preference.findFirst({
      where: {
        userId,
        locationId: normalizedLocationId,
        slug,
        status: PreferenceStatus.REJECTED,
      },
    });

    let result: PrismaPreference;

    if (existing) {
      result = await this.prisma.preference.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
      });
    } else {
      result = await this.prisma.preference.create({
        data: {
          userId,
          locationId: normalizedLocationId,
          slug,
          value,
          status: PreferenceStatus.REJECTED,
          sourceType: SourceType.INFERRED,
        },
      });
    }

    return this.enrichWithCatalog(result);
  }

  /**
   * Finds a preference by ID.
   */
  async findById(id: string): Promise<EnrichedPreference | null> {
    const result = await this.prisma.preference.findUnique({
      where: { id },
    });
    return result ? this.enrichWithCatalog(result) : null;
  }

  /**
   * Finds all preferences for a user with a specific status.
   */
  async findByStatus(
    userId: string,
    status: PreferenceStatus,
    locationId?: string | null,
  ): Promise<EnrichedPreference[]> {
    this.logger.log(
      `Fetching ${status} preferences for user: ${userId}, locationId: ${locationId ?? 'global'}`,
    );

    const results = await this.prisma.preference.findMany({
      where: {
        userId,
        status,
        ...(locationId === undefined
          ? {}
          : locationId === null
            ? { locationId: null }
            : { locationId }),
      },
      orderBy: { updatedAt: 'desc' },
    });

    return this.enrichManyWithCatalog(results);
  }

  /**
   * Finds ACTIVE preferences with merged view (global + location-specific).
   * Location-specific preferences take precedence over global ones for the same slug.
   */
  async findActiveWithMerge(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]> {
    this.logger.log(
      `Fetching merged ACTIVE preferences for user: ${userId}, location: ${locationId}`,
    );

    // Get both global and location-specific active preferences
    const [globalPrefs, locationPrefs] = await Promise.all([
      this.prisma.preference.findMany({
        where: {
          userId,
          locationId: null,
          status: PreferenceStatus.ACTIVE,
        },
      }),
      this.prisma.preference.findMany({
        where: {
          userId,
          locationId,
          status: PreferenceStatus.ACTIVE,
        },
      }),
    ]);

    // Create a map with global prefs, then override with location-specific
    const mergedMap = new Map<string, PrismaPreference>();

    for (const pref of globalPrefs) {
      mergedMap.set(pref.slug, pref);
    }

    for (const pref of locationPrefs) {
      mergedMap.set(pref.slug, pref); // Override global with location-specific
    }

    const merged = Array.from(mergedMap.values());
    merged.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return this.enrichManyWithCatalog(merged);
  }

  /**
   * Finds SUGGESTED preferences (union of global + location-specific, no merge).
   */
  async findSuggestedUnion(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]> {
    this.logger.log(
      `Fetching suggested preferences union for user: ${userId}, location: ${locationId}`,
    );

    const results = await this.prisma.preference.findMany({
      where: {
        userId,
        status: PreferenceStatus.SUGGESTED,
        OR: [{ locationId: null }, { locationId }],
      },
      orderBy: { updatedAt: 'desc' },
    });

    return this.enrichManyWithCatalog(results);
  }

  /**
   * Deletes a preference by ID.
   */
  async delete(id: string): Promise<EnrichedPreference> {
    this.logger.log(`Deleting preference: ${id}`);
    const result = await this.prisma.preference.delete({
      where: { id },
    });
    return this.enrichWithCatalog(result);
  }

  /**
   * Updates a preference's status.
   */
  async updateStatus(
    id: string,
    status: PreferenceStatus,
  ): Promise<EnrichedPreference> {
    const result = await this.prisma.preference.update({
      where: { id },
      data: { status },
    });
    return this.enrichWithCatalog(result);
  }

  /**
   * Counts preferences for a user.
   */
  async count(userId: string, status?: PreferenceStatus): Promise<number> {
    return this.prisma.preference.count({
      where: {
        userId,
        ...(status ? { status } : {}),
      },
    });
  }
}
