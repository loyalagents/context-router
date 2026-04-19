import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import type { PreferenceDefinition as PrismaPreferenceDefinition } from "@infrastructure/prisma/prisma-models";
import {
  AuditEventType,
  AuditTargetType,
  PreferenceStatus,
  SourceType,
} from "@infrastructure/prisma/generated-client";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import {
  PreferenceRepository,
  EnrichedPreference,
} from "./preference.repository";
import { LocationService } from "../location/location.service";
import { SetPreferenceInput } from "./dto/set-preference.input";
import { SuggestPreferenceInput } from "./dto/suggest-preference.input";
import { PreferenceDefinitionRepository } from "../preference-definition/preference-definition.repository";
import {
  validateSlugFormat,
  validateValue,
  enforceScope,
  validateConfidence,
} from "./preference.validation";
import { canonicalizePreferenceValue } from "./preference-value-normalization";
import { MutationContext } from "../audit/audit.types";
import { PreferenceAuditService } from "../audit/preference-audit.service";
import { buildPreferenceAuditSnapshot } from "../audit/snapshot-builders";

@Injectable()
export class PreferenceService {
  private readonly logger = new Logger(PreferenceService.name);

  constructor(
    private preferenceRepository: PreferenceRepository,
    private locationService: LocationService,
    private defRepo: PreferenceDefinitionRepository,
    private prisma: PrismaService,
    private preferenceAuditService: PreferenceAuditService,
  ) {}

  /**
   * Validates a slug and throws appropriate errors if invalid.
   * Returns the resolved definition.
   */
  private async resolveAndValidateDefinition(
    slug: string,
    userId?: string,
  ): Promise<PrismaPreferenceDefinition> {
    if (!validateSlugFormat(slug)) {
      throw new BadRequestException(
        `Invalid slug format: "${slug}". Slugs must be lowercase with dots (e.g., "food.dietary_restrictions")`,
      );
    }

    const definition = await this.defRepo.getDefinitionBySlug(slug, userId);
    if (!definition) {
      const similar = await this.defRepo.findSimilarSlugs(slug, 3, userId);
      const hint =
        similar.length > 0 ? ` Did you mean: ${similar.join(", ")}?` : "";
      throw new BadRequestException(
        `Unknown preference slug: "${slug}".${hint}`,
      );
    }

    return definition;
  }

  /**
   * Validates the value type for a slug.
   */
  private validateValueForDefinition(
    slug: string,
    definition: { valueType: PrismaPreferenceDefinition["valueType"]; options?: unknown },
    value: any,
  ): void {
    const validation = validateValue(definition, value);
    if (!validation.valid) {
      throw new BadRequestException(
        `Invalid value for "${slug}": ${validation.error}`,
      );
    }
  }

  /**
   * Validates and enforces scope rules for a preference.
   */
  private validateScopeForDefinition(
    definition: {
      scope: PrismaPreferenceDefinition["scope"];
      category?: string;
    },
    locationId?: string,
  ): void {
    const scopeValidation = enforceScope(definition, locationId);
    if (!scopeValidation.valid) {
      throw new BadRequestException(scopeValidation.error);
    }
  }

  private canonicalizeValue(
    definition: { valueType: PrismaPreferenceDefinition["valueType"] },
    value: unknown,
  ): unknown {
    return canonicalizePreferenceValue(definition, value);
  }

  private async canonicalizeValueByDefinitionId(
    definitionId: string,
    value: unknown,
  ): Promise<unknown> {
    const definition = await this.defRepo.getDefinitionById(definitionId);
    if (!definition) {
      return value;
    }

    return this.canonicalizeValue(definition, value);
  }

  /**
   * Set (create or update) an ACTIVE preference.
   * Used by authenticated users via GraphQL mutations.
   */
  async setPreference(
    userId: string,
    input: SetPreferenceInput,
    context: MutationContext,
  ): Promise<EnrichedPreference> {
    const definition = await this.resolveAndValidateDefinition(input.slug, userId);
    const normalizedValue = this.canonicalizeValue(definition, input.value);
    this.validateValueForDefinition(input.slug, definition, normalizedValue);
    this.validateScopeForDefinition(definition, input.locationId);

    // If locationId is provided, verify it exists and belongs to user
    if (input.locationId) {
      await this.locationService.findOne(input.locationId, userId);
    }

    this.logger.log(
      `Setting ACTIVE preference for user ${userId}: ${input.slug}`,
    );

    const write = await this.prisma.$transaction((tx) =>
      this.preferenceRepository
        .upsertActive(
          userId,
          definition.id,
          normalizedValue,
          input.locationId,
          {
            sourceType: context.sourceType,
            confidence: context.confidence,
            evidence: context.evidence,
          },
          tx,
        )
        .then(async (result) => {
          await this.preferenceAuditService.record(
            {
              userId,
              subjectSlug: result.result.slug,
              targetType: AuditTargetType.PREFERENCE,
              targetId: result.result.id,
              eventType: AuditEventType.PREFERENCE_SET,
              actorType: context.actorType,
              actorClientKey: context.actorClientKey,
              origin: context.origin,
              correlationId: context.correlationId,
              beforeState: result.beforeState
                ? buildPreferenceAuditSnapshot(result.beforeState)
                : null,
              afterState: buildPreferenceAuditSnapshot(result.result),
            },
            tx,
          );

          return result;
        }),
    );

    return write.result;
  }

  /**
   * Suggest a preference (creates SUGGESTED status).
   * Used by MCP tools and inference systems.
   * Returns null if the suggestion was skipped (e.g., previously rejected).
   */
  async suggestPreference(
    userId: string,
    input: SuggestPreferenceInput,
    context: MutationContext,
  ): Promise<EnrichedPreference | null> {
    const definition = await this.resolveAndValidateDefinition(input.slug, userId);
    const normalizedValue = this.canonicalizeValue(definition, input.value);
    this.validateValueForDefinition(input.slug, definition, normalizedValue);
    this.validateScopeForDefinition(definition, input.locationId);

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
      definition.id,
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

    const write = await this.prisma.$transaction((tx) =>
      this.preferenceRepository
        .upsertSuggested(
          userId,
          definition.id,
          normalizedValue,
          input.locationId,
          {
            sourceType: SourceType.INFERRED,
            confidence: input.confidence,
            evidence: input.evidence,
          },
          tx,
        )
        .then(async (result) => {
          await this.preferenceAuditService.record(
            {
              userId,
              subjectSlug: result.result.slug,
              targetType: AuditTargetType.PREFERENCE,
              targetId: result.result.id,
              eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
              actorType: context.actorType,
              actorClientKey: context.actorClientKey,
              origin: context.origin,
              correlationId: context.correlationId,
              beforeState: result.beforeState
                ? buildPreferenceAuditSnapshot(result.beforeState)
                : null,
              afterState: buildPreferenceAuditSnapshot(result.result),
            },
            tx,
          );

          return result;
        }),
    );

    return write.result;
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
      `Fetching ACTIVE preferences for user ${userId}, location: ${locationId ?? "global only"}`,
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
      `Fetching SUGGESTED preferences for user ${userId}, location: ${locationId ?? "global only"}`,
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
    context: MutationContext,
  ): Promise<EnrichedPreference> {
    // Find the suggestion
    const suggestion = await this.preferenceRepository.findById(id);

    if (!suggestion) {
      throw new NotFoundException(`Preference ${id} not found`);
    }

    // Verify ownership
    if (suggestion.userId !== userId) {
      throw new ForbiddenException(
        "You can only accept your own preference suggestions",
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

    const normalizedValue = await this.canonicalizeValueByDefinitionId(
      suggestion.definitionId,
      suggestion.value,
    );

    // Upsert the active preference with the suggested value
    const active = await this.prisma.$transaction(async (tx) => {
      const activeWrite = await this.preferenceRepository.upsertActive(
        userId,
        suggestion.definitionId,
        normalizedValue,
        suggestion.locationId,
        {
          sourceType: suggestion.sourceType,
          confidence: suggestion.confidence,
          evidence: suggestion.evidence,
        },
        tx,
      );

      await this.preferenceRepository.delete(id, tx);

      await this.preferenceAuditService.record(
        {
          userId,
          subjectSlug: activeWrite.result.slug,
          targetType: AuditTargetType.PREFERENCE,
          targetId: activeWrite.result.id,
          eventType: AuditEventType.PREFERENCE_SUGGESTION_ACCEPTED,
          actorType: context.actorType,
          actorClientKey: context.actorClientKey,
          origin: context.origin,
          correlationId: context.correlationId,
          beforeState: activeWrite.beforeState
            ? buildPreferenceAuditSnapshot(activeWrite.beforeState)
            : null,
          afterState: buildPreferenceAuditSnapshot(activeWrite.result),
          metadata: {
            consumedSuggestion: buildPreferenceAuditSnapshot(suggestion),
          },
        },
        tx,
      );

      return activeWrite;
    });

    return active.result;
  }

  /**
   * Reject a suggested preference.
   * Creates/updates a REJECTED row and deletes the suggestion.
   */
  async rejectSuggestion(
    id: string,
    userId: string,
    context: MutationContext,
  ): Promise<boolean> {
    // Find the suggestion
    const suggestion = await this.preferenceRepository.findById(id);

    if (!suggestion) {
      throw new NotFoundException(`Preference ${id} not found`);
    }

    // Verify ownership
    if (suggestion.userId !== userId) {
      throw new ForbiddenException(
        "You can only reject your own preference suggestions",
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

    const normalizedValue = await this.canonicalizeValueByDefinitionId(
      suggestion.definitionId,
      suggestion.value,
    );

    // Upsert the rejected row
    await this.prisma.$transaction(async (tx) => {
      await this.preferenceRepository
        .upsertRejected(
        userId,
        suggestion.definitionId,
        normalizedValue,
        suggestion.locationId,
        {
          sourceType: suggestion.sourceType,
          confidence: suggestion.confidence,
          evidence: suggestion.evidence,
        },
        tx,
        )
        .then(async (rejectedWrite) => {
          await this.preferenceAuditService.record(
            {
              userId,
              subjectSlug: rejectedWrite.result.slug,
              targetType: AuditTargetType.PREFERENCE,
              targetId: rejectedWrite.result.id,
              eventType: AuditEventType.PREFERENCE_SUGGESTION_REJECTED,
              actorType: context.actorType,
              actorClientKey: context.actorClientKey,
              origin: context.origin,
              correlationId: context.correlationId,
              beforeState: rejectedWrite.beforeState
                ? buildPreferenceAuditSnapshot(rejectedWrite.beforeState)
                : null,
              afterState: buildPreferenceAuditSnapshot(rejectedWrite.result),
              metadata: {
                consumedSuggestion: buildPreferenceAuditSnapshot(suggestion),
              },
            },
            tx,
          );
        });

      await this.preferenceRepository.delete(id, tx);
    });

    return true;
  }

  /**
   * Delete a preference by ID.
   */
  async deletePreference(
    id: string,
    userId: string,
    context: MutationContext,
  ): Promise<EnrichedPreference> {
    const preference = await this.preferenceRepository.findById(id);

    if (!preference) {
      throw new NotFoundException(`Preference ${id} not found`);
    }

    // Verify ownership
    if (preference.userId !== userId) {
      throw new ForbiddenException("You can only delete your own preferences");
    }

    this.logger.log(`Deleting preference ${id} for user ${userId}`);
    return this.prisma.$transaction(async (tx) => {
      const deleted = await this.preferenceRepository.delete(id, tx);

      await this.preferenceAuditService.record(
        {
          userId,
          subjectSlug: deleted.slug,
          targetType: AuditTargetType.PREFERENCE,
          targetId: deleted.id,
          eventType: AuditEventType.PREFERENCE_DELETED,
          actorType: context.actorType,
          actorClientKey: context.actorClientKey,
          origin: context.origin,
          correlationId: context.correlationId,
          beforeState: buildPreferenceAuditSnapshot(preference),
          afterState: null,
        },
        tx,
      );

      return deleted;
    });
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
      throw new ForbiddenException("You can only access your own preferences");
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
