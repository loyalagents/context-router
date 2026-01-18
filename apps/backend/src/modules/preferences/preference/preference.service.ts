import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PreferenceStatus } from '@prisma/client';
import {
  PreferenceRepository,
  EnrichedPreference,
} from './preference.repository';
import { LocationService } from '../location/location.service';
import { SetPreferenceInput } from './dto/set-preference.input';
import { SuggestPreferenceInput } from './dto/suggest-preference.input';
import {
  isKnownSlug,
  validateSlugFormat,
  getDefinition,
  validateValue,
  enforceScope,
  validateConfidence,
  findSimilarSlugs,
} from '@config/preferences.catalog';

@Injectable()
export class PreferenceService {
  private readonly logger = new Logger(PreferenceService.name);

  constructor(
    private preferenceRepository: PreferenceRepository,
    private locationService: LocationService,
  ) {}

  /**
   * Validates a slug and throws appropriate errors if invalid.
   */
  private validateSlug(slug: string): void {
    if (!validateSlugFormat(slug)) {
      throw new BadRequestException(
        `Invalid slug format: "${slug}". Slugs must be lowercase with dots (e.g., "food.dietary_restrictions")`,
      );
    }

    if (!isKnownSlug(slug)) {
      const similar = findSimilarSlugs(slug);
      const hint =
        similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new BadRequestException(
        `Unknown preference slug: "${slug}".${hint}`,
      );
    }
  }

  /**
   * Validates the value type for a slug.
   */
  private validateValueForSlug(slug: string, value: any): void {
    const def = getDefinition(slug);
    if (!def) return;

    const validation = validateValue(def, value);
    if (!validation.valid) {
      throw new BadRequestException(
        `Invalid value for "${slug}": ${validation.error}`,
      );
    }
  }

  /**
   * Validates and enforces scope rules for a preference.
   */
  private validateScope(slug: string, locationId?: string): void {
    const def = getDefinition(slug);
    if (!def) return;

    const scopeValidation = enforceScope(def, locationId);
    if (!scopeValidation.valid) {
      throw new BadRequestException(scopeValidation.error);
    }
  }

  /**
   * Set (create or update) an ACTIVE preference.
   * Used by authenticated users via GraphQL mutations.
   */
  async setPreference(
    userId: string,
    input: SetPreferenceInput,
  ): Promise<EnrichedPreference> {
    this.validateSlug(input.slug);
    this.validateValueForSlug(input.slug, input.value);
    this.validateScope(input.slug, input.locationId);

    // If locationId is provided, verify it exists and belongs to user
    if (input.locationId) {
      await this.locationService.findOne(input.locationId, userId);
    }

    this.logger.log(
      `Setting ACTIVE preference for user ${userId}: ${input.slug}`,
    );

    return this.preferenceRepository.upsertActive(
      userId,
      input.slug,
      input.value,
      input.locationId,
    );
  }

  /**
   * Suggest a preference (creates SUGGESTED status).
   * Used by MCP tools and inference systems.
   * Returns null if the suggestion was skipped (e.g., previously rejected).
   */
  async suggestPreference(
    userId: string,
    input: SuggestPreferenceInput,
  ): Promise<EnrichedPreference | null> {
    this.validateSlug(input.slug);
    this.validateValueForSlug(input.slug, input.value);
    this.validateScope(input.slug, input.locationId);

    // Validate confidence
    const confidenceValidation = validateConfidence(input.confidence);
    if (!confidenceValidation.valid) {
      throw new BadRequestException(confidenceValidation.error);
    }

    // If locationId is provided, verify it exists and belongs to user
    if (input.locationId) {
      await this.locationService.findOne(input.locationId, userId);
    }

    // Check if a REJECTED row exists for this preference
    const hasRejected = await this.preferenceRepository.hasRejected(
      userId,
      input.slug,
      input.locationId,
    );

    if (hasRejected) {
      this.logger.log(
        `Suggestion skipped for user ${userId}: ${input.slug} was previously rejected`,
      );
      return null; // No-op: user previously rejected this preference
    }

    this.logger.log(
      `Creating SUGGESTED preference for user ${userId}: ${input.slug}`,
    );

    return this.preferenceRepository.upsertSuggested(
      userId,
      input.slug,
      input.value,
      input.confidence,
      input.locationId,
      input.evidence,
    );
  }

  /**
   * Get all ACTIVE preferences for a user.
   * If locationId is provided, returns merged view (global + location-specific).
   * If locationId is null/undefined, returns only global preferences.
   */
  async getActivePreferences(
    userId: string,
    locationId?: string,
  ): Promise<EnrichedPreference[]> {
    this.logger.log(
      `Fetching ACTIVE preferences for user ${userId}, location: ${locationId ?? 'global only'}`,
    );

    if (locationId) {
      // Verify location exists and belongs to user
      await this.locationService.findOne(locationId, userId);
      return this.preferenceRepository.findActiveWithMerge(userId, locationId);
    }

    // Return only global preferences
    return this.preferenceRepository.findByStatus(
      userId,
      PreferenceStatus.ACTIVE,
      null,
    );
  }

  /**
   * Get all SUGGESTED preferences for a user.
   * If locationId is provided, returns union of global + location-specific.
   * If locationId is null/undefined, returns only global suggestions.
   */
  async getSuggestedPreferences(
    userId: string,
    locationId?: string,
  ): Promise<EnrichedPreference[]> {
    this.logger.log(
      `Fetching SUGGESTED preferences for user ${userId}, location: ${locationId ?? 'global only'}`,
    );

    if (locationId) {
      // Verify location exists and belongs to user
      await this.locationService.findOne(locationId, userId);
      return this.preferenceRepository.findSuggestedUnion(userId, locationId);
    }

    // Return only global suggestions
    return this.preferenceRepository.findByStatus(
      userId,
      PreferenceStatus.SUGGESTED,
      null,
    );
  }

  /**
   * Accept a suggested preference, promoting it to ACTIVE.
   * Deletes the suggestion after creating/updating the active row.
   */
  async acceptSuggestion(
    id: string,
    userId: string,
  ): Promise<EnrichedPreference> {
    // Find the suggestion
    const suggestion = await this.preferenceRepository.findById(id);

    if (!suggestion) {
      throw new NotFoundException(`Preference ${id} not found`);
    }

    // Verify ownership
    if (suggestion.userId !== userId) {
      throw new ForbiddenException(
        'You can only accept your own preference suggestions',
      );
    }

    // Verify it's a suggestion
    if (suggestion.status !== PreferenceStatus.SUGGESTED) {
      throw new BadRequestException(
        `Preference ${id} is not a suggestion (status: ${suggestion.status})`,
      );
    }

    this.logger.log(
      `Accepting suggestion ${id} for user ${userId}: ${suggestion.slug}`,
    );

    // Upsert the active preference with the suggested value
    const active = await this.preferenceRepository.upsertActive(
      userId,
      suggestion.slug,
      suggestion.value,
      suggestion.locationId,
    );

    // Delete the suggestion
    await this.preferenceRepository.delete(id);

    return active;
  }

  /**
   * Reject a suggested preference.
   * Creates/updates a REJECTED row and deletes the suggestion.
   */
  async rejectSuggestion(id: string, userId: string): Promise<boolean> {
    // Find the suggestion
    const suggestion = await this.preferenceRepository.findById(id);

    if (!suggestion) {
      throw new NotFoundException(`Preference ${id} not found`);
    }

    // Verify ownership
    if (suggestion.userId !== userId) {
      throw new ForbiddenException(
        'You can only reject your own preference suggestions',
      );
    }

    // Verify it's a suggestion
    if (suggestion.status !== PreferenceStatus.SUGGESTED) {
      throw new BadRequestException(
        `Preference ${id} is not a suggestion (status: ${suggestion.status})`,
      );
    }

    this.logger.log(
      `Rejecting suggestion ${id} for user ${userId}: ${suggestion.slug}`,
    );

    // Upsert the rejected row
    await this.preferenceRepository.upsertRejected(
      userId,
      suggestion.slug,
      suggestion.value,
      suggestion.locationId,
    );

    // Delete the suggestion
    await this.preferenceRepository.delete(id);

    return true;
  }

  /**
   * Delete a preference by ID.
   */
  async deletePreference(
    id: string,
    userId: string,
  ): Promise<EnrichedPreference> {
    const preference = await this.preferenceRepository.findById(id);

    if (!preference) {
      throw new NotFoundException(`Preference ${id} not found`);
    }

    // Verify ownership
    if (preference.userId !== userId) {
      throw new ForbiddenException('You can only delete your own preferences');
    }

    this.logger.log(`Deleting preference ${id} for user ${userId}`);
    return this.preferenceRepository.delete(id);
  }

  /**
   * Get a single preference by ID.
   */
  async getPreference(id: string, userId: string): Promise<EnrichedPreference> {
    const preference = await this.preferenceRepository.findById(id);

    if (!preference) {
      throw new NotFoundException(`Preference ${id} not found`);
    }

    // Verify ownership
    if (preference.userId !== userId) {
      throw new ForbiddenException('You can only access your own preferences');
    }

    return preference;
  }

  /**
   * Count preferences for a user.
   */
  async count(userId: string, status?: PreferenceStatus): Promise<number> {
    return this.preferenceRepository.count(userId, status);
  }
}
