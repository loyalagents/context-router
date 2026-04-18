import { Injectable, Inject, Logger } from '@nestjs/common';
import type { PreferenceDefinition as PrismaPreferenceDefinition } from '@infrastructure/prisma/prisma-models';
import { z } from 'zod';
import { AiStructuredOutputPort } from '../../../domains/shared/ports/ai-structured-output.port';
import { PreferenceService } from '../preference/preference.service';
import {
  PreferenceSuggestion,
  PreferenceOperation,
  FilteredSuggestion,
  FilterReason,
} from './dto/preference-suggestion.dto';
import { getDocumentUploadConfig } from '../../../config/document-upload.config';
import { PreferenceDefinitionRepository } from '../preference-definition/preference-definition.repository';
import { PreferenceSchemaSnapshotService } from '../preference-definition/preference-schema-snapshot.service';
import { buildDuplicateConsolidationPrompt } from './duplicate-consolidation.prompt';
import { buildDuplicateConsolidationSchema } from './duplicate-consolidation.schema';
import { canonicalizePreferenceValue } from '../preference/preference-value-normalization';

/**
 * Zod schema for validating AI response structure.
 * AI returns slug-based suggestions matching our catalog.
 */
const AiSuggestionSchema = z.object({
  slug: z.string(),
  operation: z.enum(['CREATE', 'UPDATE']),
  oldValue: z.any().optional(),
  newValue: z.any(),
  confidence: z.number().min(0).max(1),
  sourceSnippet: z.string(),
  sourceMeta: z
    .object({
      page: z.number().optional().nullable(),
      line: z.number().optional().nullable(),
    })
    .optional()
    .nullable(),
});

const AiResponseSchema = z.object({
  suggestions: z.array(AiSuggestionSchema),
  documentSummary: z.string(),
});

type AiSuggestionSchemaType = z.infer<typeof AiSuggestionSchema>;
type AiResponseSchemaType = z.infer<typeof AiResponseSchema>;
type ConsolidatedAiResponse = {
  suggestion: AiSuggestionSchemaType;
};
type NormalizationResult =
  | { kind: 'accepted'; suggestion: PreferenceSuggestion }
  | { kind: 'filtered'; suggestion: FilteredSuggestion };

@Injectable()
export class PreferenceExtractionService {
  private readonly logger = new Logger(PreferenceExtractionService.name);
  private readonly config = getDocumentUploadConfig();

  constructor(
    @Inject('AiStructuredOutputPort')
    private readonly aiStructuredService: AiStructuredOutputPort,
    private readonly preferenceService: PreferenceService,
    private readonly defRepo: PreferenceDefinitionRepository,
    private readonly snapshotService: PreferenceSchemaSnapshotService,
  ) {}

  async extractPreferences(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<{
    suggestions: PreferenceSuggestion[];
    filteredSuggestions: FilteredSuggestion[];
    documentSummary: string;
    filteredCount: number;
  }> {
    // Fetch user's current ACTIVE preferences
    const currentPreferences =
      await this.preferenceService.getActivePreferences(userId);

    // Build the prompt with catalog-based schema
    const prompt = await this.buildExtractionPrompt(
      currentPreferences.map((p) => ({
        slug: p.slug,
        value: p.value,
      })),
      filename,
      userId,
    );

    this.logger.log(`Calling AI for preference extraction from ${filename}`);

    // Call the AI with the file — port handles fence stripping, JSON parsing, Zod validation
    const aiResult: AiResponseSchemaType =
      await this.aiStructuredService.generateStructuredWithFile(
        prompt,
        { buffer: fileBuffer, mimeType },
        AiResponseSchema,
        { operationName: 'preferenceExtraction' },
      );

    // Transform validated AI data to domain types
    const parsed = this.transformAiResult(aiResult);

    return this.validateAndSanitizeSuggestions(
      parsed,
      currentPreferences.map((p) => ({
        slug: p.slug,
        value: p.value,
      })),
      userId,
    );
  }

  private async buildExtractionPrompt(
    currentPreferences: Array<{ slug: string; value: any }>,
    filename: string,
    userId: string,
  ): Promise<string> {
    const snapshot = await this.snapshotService.getSnapshot(userId);
    const currentPreferencesJson = JSON.stringify(currentPreferences, null, 2);

    return `You are a data extraction assistant that reads documents and proposes preference changes for a user.

Here is the user's current preference schema (valid slugs):
${snapshot.promptJson}

Here are the user's current preferences:
${currentPreferencesJson}

The document "${filename}" is attached above.

Task:
- Analyze the attached document for any information that indicates a new or updated preference.
- For each item, output a suggestion object using a valid slug from the schema.
- Only suggest changes with clear evidence in the document.
- Return at most ${this.config.maxSuggestions} suggestions, prioritizing higher-confidence items.
- Use ONLY slugs from the schema above. Invalid slugs will be rejected.
- If a preference already exists with the same value, do not include it.
- For UPDATE operations, include the oldValue from current preferences.

Respond with JSON only (no markdown code blocks):
{
  "suggestions": [
    {
      "slug": "string (from schema above, e.g. 'food.dietary_restrictions')",
      "operation": "CREATE" | "UPDATE",
      "oldValue": any | null,
      "newValue": any,
      "confidence": 0.0-1.0,
      "sourceSnippet": "string (quote from document)",
      "sourceMeta": { "page": number | null, "line": number | null }
    }
  ],
  "documentSummary": "Brief 1-2 sentence summary of what the document contains"
}

If no preferences can be extracted, return:
{
  "suggestions": [],
  "documentSummary": "Brief summary of document"
}`;
  }

  private transformAiResult(
    aiResult: AiResponseSchemaType,
  ): { suggestions: PreferenceSuggestion[]; documentSummary: string } {
    const suggestions: PreferenceSuggestion[] = aiResult.suggestions
      .slice(0, this.config.maxSuggestions)
      .map((s: AiSuggestionSchemaType, index: number) => {
        return {
          id: `candidate:${index}`,
          slug: s.slug,
          operation:
            s.operation === 'UPDATE'
              ? PreferenceOperation.UPDATE
              : PreferenceOperation.CREATE,
          oldValue: s.oldValue,
          newValue: s.newValue,
          confidence: s.confidence,
          sourceSnippet: s.sourceSnippet,
          sourceMeta: s.sourceMeta
            ? {
                page: s.sourceMeta.page ?? undefined,
                line: s.sourceMeta.line ?? undefined,
              }
            : undefined,
          wasCorrected: false,
          category: s.slug.split('.')[0],
          description: undefined,
        };
      });

    this.logger.log(
      `[AI_PARSE_SUCCESS] Parsed ${suggestions.length} suggestions from AI response`,
    );

    return {
      suggestions,
      documentSummary: aiResult.documentSummary,
    };
  }

  /**
   * Validates and sanitizes AI-generated suggestions against actual DB state.
   *
   * - Prefilters hard-invalid suggestions (unknown slug, missing fields)
   * - Groups remaining suggestions by exact slug
   * - Consolidates duplicate groups via a second AI pass
   * - Corrects operation/oldValue and filters no-change against DB state
   * - Keeps duplicate audit items for UI visibility
   */
  private async validateAndSanitizeSuggestions(
    parsed: { suggestions: PreferenceSuggestion[]; documentSummary: string },
    currentPreferences: Array<{ slug: string; value: any }>,
    userId: string,
  ): Promise<{
    suggestions: PreferenceSuggestion[];
    filteredSuggestions: FilteredSuggestion[];
    documentSummary: string;
    filteredCount: number;
  }> {
    this.logger.debug(
      `Raw AI suggestions (${parsed.suggestions.length}): ${JSON.stringify(
        parsed.suggestions.map((s) => ({
          slug: s.slug,
          operation: s.operation,
          newValue: s.newValue,
          confidence: s.confidence,
        })),
      )}`,
    );

    // Build a lookup map for current preferences
    const definitionCache = new Map<string, PrismaPreferenceDefinition>();
    const preferenceMap = new Map<string, any>();
    for (const pref of currentPreferences) {
      preferenceMap.set(
        pref.slug,
        await this.canonicalizeValueForSlug(
          pref.slug,
          pref.value,
          userId,
          definitionCache,
        ),
      );
    }

    const validatedSuggestions: PreferenceSuggestion[] = [];
    const filteredSuggestions: FilteredSuggestion[] = [];
    const candidates: PreferenceSuggestion[] = [];

    for (const suggestion of parsed.suggestions) {
      const prefiltered = await this.prefilterSuggestion(
        suggestion,
        userId,
        definitionCache,
      );
      if (prefiltered) {
        filteredSuggestions.push(prefiltered);
        continue;
      }

      candidates.push(
        await this.canonicalizeSuggestionValues(
          suggestion,
          userId,
          definitionCache,
        ),
      );
    }

    const groupedSuggestions = new Map<string, PreferenceSuggestion[]>();
    for (const suggestion of candidates) {
      const existingGroup = groupedSuggestions.get(suggestion.slug) ?? [];
      existingGroup.push(suggestion);
      groupedSuggestions.set(suggestion.slug, existingGroup);
    }

    for (const [slug, group] of groupedSuggestions.entries()) {
      if (group.length === 1) {
        this.pushNormalizationResult(
          this.normalizeSuggestion(group[0], preferenceMap),
          validatedSuggestions,
          filteredSuggestions,
        );
        continue;
      }

      this.logger.log(
        `[DUPLICATE_GROUP_DETECTED] slug=${slug} candidateCount=${group.length}`,
      );

      try {
        const consolidatedSuggestion = await this.consolidateDuplicateGroup(
          slug,
          group,
          preferenceMap.get(slug),
        );

        filteredSuggestions.push(
          ...group.map((candidate) =>
            this.buildDuplicateAuditSuggestion(
              candidate,
              `Merged into consolidated suggestion for ${slug}`,
            ),
          ),
        );

        const normalizedConsolidated = this.normalizeSuggestion(
          await this.canonicalizeSuggestionValues(
            consolidatedSuggestion,
            userId,
            definitionCache,
          ),
          preferenceMap,
        );

        if (normalizedConsolidated.kind === 'accepted') {
          validatedSuggestions.push(normalizedConsolidated.suggestion);
          this.logger.log(
            `[DUPLICATE_GROUP_CONSOLIDATED] slug=${slug} candidateCount=${group.length}`,
          );
          continue;
        }

        filteredSuggestions.push(
          this.buildConsolidatedNoChangeSuggestion(
            normalizedConsolidated.suggestion,
            group.length,
          ),
        );
        this.logger.log(
          `[DUPLICATE_GROUP_NO_CHANGE] slug=${slug} candidateCount=${group.length}`,
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'unknown consolidation error';
        this.logger.warn(
          `[DUPLICATE_GROUP_FALLBACK_FIRST] slug=${slug} candidateCount=${group.length} reason=${reason}`,
        );

        this.pushNormalizationResult(
          this.normalizeSuggestion(group[0], preferenceMap),
          validatedSuggestions,
          filteredSuggestions,
        );
        filteredSuggestions.push(
          ...group.slice(1).map((candidate) =>
            this.buildDuplicateAuditSuggestion(
              candidate,
              `Retained first valid candidate for ${slug}; this duplicate was not applied`,
            ),
          ),
        );
      }
    }

    this.logger.log(
      `Validation complete: ${validatedSuggestions.length} valid suggestions, ${filteredSuggestions.length} filtered`,
    );

    return {
      suggestions: validatedSuggestions,
      filteredSuggestions,
      documentSummary: parsed.documentSummary,
      filteredCount: filteredSuggestions.length,
    };
  }

  private async prefilterSuggestion(
    suggestion: PreferenceSuggestion,
    userId: string,
    definitionCache: Map<string, PrismaPreferenceDefinition>,
  ): Promise<FilteredSuggestion | null> {
    const originalIndex = this.getOriginalIndex(suggestion.id);

    if (!suggestion.slug || suggestion.newValue === undefined) {
      const details = `slug: ${suggestion.slug}, newValue: ${suggestion.newValue}`;
      this.logger.warn(
        `Filtered suggestion: missing required field(s) - ${details}`,
      );
      return {
        ...suggestion,
        id: `filtered:invalid:${originalIndex}`,
        filterReason: FilterReason.MISSING_FIELDS,
        filterDetails: details,
      };
    }

    const definition = await this.getDefinitionForSlug(
      suggestion.slug,
      userId,
      definitionCache,
    );
    if (!definition) {
      this.logger.warn(`Filtered suggestion: unknown slug "${suggestion.slug}"`);
      return {
        ...suggestion,
        id: `filtered:invalid:${originalIndex}`,
        filterReason: FilterReason.UNKNOWN_SLUG,
        filterDetails: `Slug "${suggestion.slug}" is not in the catalog`,
      };
    }

    return null;
  }

  private normalizeSuggestion(
    suggestion: PreferenceSuggestion,
    preferenceMap: Map<string, any>,
  ): NormalizationResult {
    const normalizedSuggestion: PreferenceSuggestion = { ...suggestion };
    const existingValue = preferenceMap.get(normalizedSuggestion.slug);
    const existsInDb = preferenceMap.has(normalizedSuggestion.slug);
    let wasCorrected = false;

    const expectedOperation = existsInDb
      ? PreferenceOperation.UPDATE
      : PreferenceOperation.CREATE;

    if (normalizedSuggestion.operation !== expectedOperation) {
      this.logger.warn(
        `Corrected operation for ${normalizedSuggestion.slug}: AI said ${normalizedSuggestion.operation}, but DB says ${expectedOperation}`,
      );
      normalizedSuggestion.operation = expectedOperation;
      wasCorrected = true;
    }

    if (existsInDb) {
      const actualOldValue = existingValue;
      const aiOldValue = normalizedSuggestion.oldValue;
      const oldValueMatches =
        JSON.stringify(actualOldValue) === JSON.stringify(aiOldValue);

      if (!oldValueMatches) {
        this.logger.warn(
          `Corrected oldValue for ${normalizedSuggestion.slug}: AI said ${JSON.stringify(aiOldValue)}, actual is ${JSON.stringify(actualOldValue)}`,
        );
        normalizedSuggestion.oldValue = actualOldValue;
        wasCorrected = true;
      }
    } else if (
      normalizedSuggestion.oldValue !== undefined &&
      normalizedSuggestion.oldValue !== null
    ) {
      this.logger.warn(
        `Corrected oldValue for ${normalizedSuggestion.slug}: removed oldValue for CREATE operation`,
      );
      normalizedSuggestion.oldValue = undefined;
      wasCorrected = true;
    }

    if (
      existsInDb &&
      JSON.stringify(existingValue) ===
        JSON.stringify(normalizedSuggestion.newValue)
    ) {
      this.logger.warn(
        `Filtered suggestion: ${normalizedSuggestion.slug} newValue matches existing value (no change)`,
      );
      return {
        kind: 'filtered',
        suggestion: {
          ...normalizedSuggestion,
          wasCorrected,
          filterReason: FilterReason.NO_CHANGE,
          filterDetails: `Value "${JSON.stringify(normalizedSuggestion.newValue)}" already exists`,
        },
      };
    }

    return {
      kind: 'accepted',
      suggestion: {
        ...normalizedSuggestion,
        wasCorrected,
      },
    };
  }

  private pushNormalizationResult(
    result: NormalizationResult,
    validatedSuggestions: PreferenceSuggestion[],
    filteredSuggestions: FilteredSuggestion[],
  ): void {
    if (result.kind === 'accepted') {
      validatedSuggestions.push(result.suggestion);
      return;
    }

    filteredSuggestions.push(result.suggestion);
  }

  private async consolidateDuplicateGroup(
    slug: string,
    suggestions: PreferenceSuggestion[],
    currentValue: any,
  ): Promise<PreferenceSuggestion> {
    const consolidationPrompt = buildDuplicateConsolidationPrompt(
      slug,
      currentValue,
      JSON.stringify(
        suggestions.map((suggestion) => ({
          operation: suggestion.operation,
          oldValue: suggestion.oldValue,
          newValue: suggestion.newValue,
          confidence: suggestion.confidence,
          sourceSnippet: suggestion.sourceSnippet,
          sourceMeta: suggestion.sourceMeta,
        })),
        null,
        2,
      ),
    );
    const schema = buildDuplicateConsolidationSchema(slug);
    const result: ConsolidatedAiResponse =
      await this.aiStructuredService.generateStructured(
        consolidationPrompt,
        schema,
        { operationName: `preferenceExtraction.duplicateConsolidation.${slug}` },
      );

    return {
      id: `consolidated:${slug}`,
      slug: result.suggestion.slug,
      operation:
        result.suggestion.operation === 'UPDATE'
          ? PreferenceOperation.UPDATE
          : PreferenceOperation.CREATE,
      oldValue: result.suggestion.oldValue,
      newValue: result.suggestion.newValue,
      confidence: result.suggestion.confidence,
      sourceSnippet: result.suggestion.sourceSnippet,
      sourceMeta: result.suggestion.sourceMeta
        ? {
            page: result.suggestion.sourceMeta.page ?? undefined,
            line: result.suggestion.sourceMeta.line ?? undefined,
          }
        : undefined,
      wasCorrected: false,
      category: slug.split('.')[0],
      description: undefined,
    };
  }

  private buildDuplicateAuditSuggestion(
    suggestion: PreferenceSuggestion,
    filterDetails: string,
  ): FilteredSuggestion {
    return {
      ...suggestion,
      id: `filtered:duplicate:${suggestion.slug}:${this.getOriginalIndex(suggestion.id)}`,
      filterReason: FilterReason.DUPLICATE_KEY,
      filterDetails,
    };
  }

  private buildConsolidatedNoChangeSuggestion(
    suggestion: FilteredSuggestion,
    candidateCount: number,
  ): FilteredSuggestion {
    return {
      ...suggestion,
      id: `filtered:consolidated-no-change:${suggestion.slug}`,
      filterReason: FilterReason.NO_CHANGE,
      filterDetails: `Consolidated ${candidateCount} candidates for ${suggestion.slug}, but the merged value matches the existing preference.`,
    };
  }

  private getOriginalIndex(id: string): string {
    return id.replace(/^candidate:/, '');
  }

  private async getDefinitionForSlug(
    slug: string,
    userId: string,
    definitionCache: Map<string, PrismaPreferenceDefinition>,
  ): Promise<PrismaPreferenceDefinition | null> {
    const cached = definitionCache.get(slug);
    if (cached) {
      return cached;
    }

    const definition = await this.defRepo.getDefinitionBySlug(slug, userId);
    if (definition) {
      definitionCache.set(slug, definition);
    }

    return definition;
  }

  private async canonicalizeValueForSlug(
    slug: string,
    value: unknown,
    userId: string,
    definitionCache: Map<string, PrismaPreferenceDefinition>,
  ): Promise<unknown> {
    const definition = await this.getDefinitionForSlug(
      slug,
      userId,
      definitionCache,
    );
    if (!definition) {
      return value;
    }

    return canonicalizePreferenceValue(definition, value);
  }

  private async canonicalizeSuggestionValues(
    suggestion: PreferenceSuggestion,
    userId: string,
    definitionCache: Map<string, PrismaPreferenceDefinition>,
  ): Promise<PreferenceSuggestion> {
    return {
      ...suggestion,
      oldValue: await this.canonicalizeValueForSlug(
        suggestion.slug,
        suggestion.oldValue,
        userId,
        definitionCache,
      ),
      newValue: await this.canonicalizeValueForSlug(
        suggestion.slug,
        suggestion.newValue,
        userId,
        definitionCache,
      ),
    };
  }
}
