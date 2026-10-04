import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageUnitOfWork } from '@/domains/shared/storage/storage-unit-of-work';
import { StorageConflictError } from '@/domains/shared/storage/storage-errors';
import { preferenceRevision } from '../preference/preference-revision';
import { canonicalizePreferenceValue } from '../preference/preference-value-normalization';
import {
  enforceScope,
  validateConfidence,
  validateSlugFormat,
  validateValue,
} from '../preference/preference.validation';
import { buildPreferenceAuditSnapshot } from '../audit/snapshot-builders';
import {
  PreferenceOperation,
  PreferenceSuggestion,
} from './dto/preference-suggestion.dto';
import type { ApplyPreferenceSuggestionV2Input } from './dto/apply-suggestion-v2.input';
import type { EnrichedPreference } from '../preference/preference.repository';

class ReviewedStateConflict extends Error {}
type ItemResult = {
  suggestionId: string;
  status: 'APPLIED' | 'CONFLICT' | 'VALIDATION_FAILED' | 'UNCERTAIN';
  preference?: EnrichedPreference;
};

@Injectable()
export class ReviewedSuggestionService {
  private readonly limit: number;
  constructor(
    private readonly unit: StorageUnitOfWork,
    configuration: ConfigService,
  ) {
    this.limit = configuration.getOrThrow<number>(
      'documentUpload.maxSuggestions',
    );
  }
  /** Capture the exact displayed before-state after inference, without a transaction across model work. */
  async prepare(
    userId: string,
    suggestions: PreferenceSuggestion[],
  ): Promise<PreferenceSuggestion[]> {
    return this.unit.serializable(async (tx) => {
      const result: PreferenceSuggestion[] = [];
      for (const suggestion of suggestions) {
        const definition = await tx.definitions.getDefinitionBySlug(
          suggestion.slug,
          userId,
        );
        if (
          !definition ||
          (definition.ownerUserId !== null && definition.ownerUserId !== userId)
        ) {
          result.push({ ...suggestion, review: undefined });
          continue;
        }
        const current = await tx.preferences.findActiveExact({
          userId,
          definitionId: definition.id,
          locationId: null,
        });
        result.push({
          ...suggestion,
          operation: current
            ? PreferenceOperation.UPDATE
            : PreferenceOperation.CREATE,
          oldValue: current?.value,
          review: {
            definitionId: definition.id,
            locationId: null,
            expectedPreferenceId: current?.id ?? null,
            expectedRevision: current ? preferenceRevision(current) : null,
          },
        });
      }
      return result;
    });
  }
  async apply(
    userId: string,
    analysisId: string,
    input: ApplyPreferenceSuggestionV2Input[],
  ): Promise<{ schemaVersion: number; results: ItemResult[] }> {
    if (
      !Array.isArray(input) ||
      !Number.isSafeInteger(this.limit) ||
      this.limit < 1 ||
      input.length > this.limit ||
      typeof analysisId !== 'string' ||
      !analysisId ||
      analysisId.length > 128
    )
      throw new BadRequestException('Invalid reviewed proposal batch');
    const results: ItemResult[] = [];
    for (const item of input) {
      try {
        const preference = await this.unit.serializable(async (tx) => {
          if (
            !item ||
            typeof item.suggestionId !== 'string' ||
            !item.suggestionId ||
            item.suggestionId.length > 256 ||
            typeof item.slug !== 'string' ||
            item.slug.length > 128 ||
            !validateSlugFormat(item.slug) ||
            typeof item.definitionId !== 'string' ||
            !item.definitionId ||
            item.definitionId.length > 128 ||
            (item.locationId != null &&
              (typeof item.locationId !== 'string' ||
                !item.locationId ||
                item.locationId.length > 128)) ||
            ![PreferenceOperation.CREATE, PreferenceOperation.UPDATE].includes(
              item.operation,
            ) ||
            !validateConfidence(item.confidence).valid
          )
            throw new BadRequestException();
          const expected =
            item.operation === PreferenceOperation.UPDATE
              ? {
                  id: item.expectedPreferenceId,
                  revision: item.expectedRevision,
                }
              : null;
          if (
            expected
              ? typeof expected.id !== 'string' ||
                !expected.id ||
                expected.id.length > 128 ||
                typeof expected.revision !== 'string' ||
                !/^[a-f0-9]{64}$/.test(expected.revision)
              : item.expectedPreferenceId != null ||
                item.expectedRevision != null
          )
            throw new BadRequestException();
          const definition = await tx.definitions.getDefinitionBySlug(
            item.slug,
            userId,
          );
          if (
            !definition ||
            definition.id !== item.definitionId ||
            definition.archivedAt ||
            (definition.ownerUserId !== null &&
              definition.ownerUserId !== userId)
          )
            throw new ReviewedStateConflict();
          const value = canonicalizePreferenceValue(definition, item.newValue, {
            slug: item.slug,
          });
          if (
            !validateValue(definition, value).valid ||
            !enforceScope(definition, item.locationId).valid
          )
            throw new BadRequestException();
          if (item.locationId) {
            const location = await tx.locations.findOne(item.locationId);
            if (!location || location.userId !== userId)
              throw new BadRequestException();
          }
          const write = await tx.preferences.compareAndSetActive(
            {
              userId,
              definitionId: definition.id,
              locationId: item.locationId ?? null,
            },
            expected,
            value,
            {
              sourceType: 'INFERRED',
              confidence: item.confidence,
              evidence: item.evidence,
            },
            { actorType: 'USER', origin: 'DOCUMENT_ANALYSIS' },
          );
          if (!write) throw new ReviewedStateConflict();
          await tx.audit.record({
            userId,
            subjectSlug: item.slug,
            targetType: 'PREFERENCE',
            targetId: write.result.id,
            eventType: 'PREFERENCE_SET',
            actorType: 'USER',
            origin: 'DOCUMENT_ANALYSIS',
            correlationId: analysisId,
            beforeState: write.beforeState
              ? buildPreferenceAuditSnapshot(write.beforeState)
              : null,
            afterState: buildPreferenceAuditSnapshot(write.result),
          });
          return write.result;
        });
        results.push({
          suggestionId: item.suggestionId,
          status: 'APPLIED',
          preference,
        });
      } catch (error) {
        results.push({
          suggestionId: item?.suggestionId ?? '',
          status:
            error instanceof BadRequestException
              ? 'VALIDATION_FAILED'
              : error instanceof ReviewedStateConflict ||
                  error instanceof StorageConflictError
                ? 'CONFLICT'
                : 'UNCERTAIN',
        });
      }
    }
    return { schemaVersion: 2, results };
  }
}
