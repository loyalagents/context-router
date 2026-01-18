import { Injectable, Inject, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AiTextGeneratorPort } from '../../../domains/shared/ports/ai-text-generator.port';
import { PreferenceService } from '../preference/preference.service';
import {
  PreferenceSuggestion,
  PreferenceOperation,
  FilteredSuggestion,
  FilterReason,
} from './dto/preference-suggestion.dto';
import { getDocumentUploadConfig } from '../../../config/document-upload.config';
import {
  PREFERENCE_CATALOG,
  getAllSlugs,
  getDefinition,
  isKnownSlug,
} from '@config/preferences.catalog';

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

@Injectable()
export class PreferenceExtractionService {
  private readonly logger = new Logger(PreferenceExtractionService.name);
  private readonly config = getDocumentUploadConfig();

  constructor(
    @Inject('AiTextGeneratorPort')
    private readonly aiService: AiTextGeneratorPort,
    private readonly preferenceService: PreferenceService,
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
    const prompt = this.buildExtractionPrompt(
      currentPreferences.map((p) => ({
        slug: p.slug,
        value: p.value,
      })),
      filename,
    );

    this.logger.log(`Calling AI for preference extraction from ${filename}`);

    // Call the AI with the file
    const aiResponse = await this.aiService.generateTextWithFile(prompt, {
      buffer: fileBuffer,
      mimeType,
    });

    // Parse and validate the response
    const parsed = this.parseAiResponse(aiResponse, userId);
    return this.validateAndSanitizeSuggestions(
      parsed,
      currentPreferences.map((p) => ({
        slug: p.slug,
        value: p.value,
      })),
    );
  }

  private buildExtractionPrompt(
    currentPreferences: Array<{ slug: string; value: any }>,
    filename: string,
  ): string {
    // Build schema from catalog
    const catalogSchema = getAllSlugs().map((slug) => {
      const def = getDefinition(slug);
      return {
        slug,
        category: def?.category,
        description: def?.description,
        valueType: def?.valueType,
        options: def?.options,
      };
    });

    const schemaJson = JSON.stringify(catalogSchema, null, 2);
    const currentPreferencesJson = JSON.stringify(currentPreferences, null, 2);

    return `You are a data extraction assistant that reads documents and proposes preference changes for a user.

Here is the user's current preference schema (valid slugs):
${schemaJson}

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

  private parseAiResponse(
    aiResponse: string,
    analysisId: string,
  ): { suggestions: PreferenceSuggestion[]; documentSummary: string } {
    // Clean up the response - remove markdown code blocks if present
    let cleanResponse = aiResponse.trim();
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.slice(7);
    } else if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.slice(3);
    }
    if (cleanResponse.endsWith('```')) {
      cleanResponse = cleanResponse.slice(0, -3);
    }
    cleanResponse = cleanResponse.trim();

    // Step 1: Parse JSON
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(cleanResponse);
    } catch {
      this.logger.error(
        '[AI_PARSE_ERROR] JSON.parse failed - invalid JSON syntax',
      );
      this.logger.debug(`[AI_PARSE_ERROR] Raw response: ${aiResponse}`);
      throw new Error('Failed to parse AI response: invalid JSON');
    }

    // Step 2: Validate with Zod schema
    const validationResult = AiResponseSchema.safeParse(rawParsed);

    if (!validationResult.success) {
      // Log detailed validation errors
      const zodIssues = validationResult.error.issues;
      this.logger.error(
        `[AI_VALIDATION_ERROR] Zod validation failed with ${zodIssues.length} issue(s)`,
      );

      for (const issue of zodIssues) {
        const path = issue.path.join('.');
        this.logger.error(
          `[AI_VALIDATION_ERROR] Field "${path}": ${issue.message} (code: ${issue.code})`,
        );
      }

      this.logger.debug(
        `[AI_VALIDATION_ERROR] Raw parsed object: ${JSON.stringify(rawParsed, null, 2)}`,
      );

      throw new Error(
        `Failed to parse AI response: validation failed at ${zodIssues.map((i) => i.path.join('.')).join(', ')}`,
      );
    }

    const parsed: AiResponseSchemaType = validationResult.data;

    // Step 3: Transform validated data to PreferenceSuggestion[]
    const suggestions: PreferenceSuggestion[] = parsed.suggestions
      .slice(0, this.config.maxSuggestions)
      .map((s: AiSuggestionSchemaType, index: number) => {
        const def = getDefinition(s.slug);
        return {
          id: `${analysisId}:${index}`,
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
          category: def?.category,
          description: def?.description,
        };
      });

    this.logger.log(
      `[AI_PARSE_SUCCESS] Parsed ${suggestions.length} suggestions from AI response`,
    );

    return {
      suggestions,
      documentSummary: parsed.documentSummary,
    };
  }

  /**
   * Validates and sanitizes AI-generated suggestions against actual DB state.
   *
   * - Filters out suggestions with invalid/unknown slugs
   * - Filters out suggestions missing required fields (slug, newValue)
   * - Corrects operation type (CREATE vs UPDATE) based on DB state
   * - Corrects oldValue with actual DB value if exists
   * - Deduplicates by slug (keeps first occurrence)
   * - Sets wasCorrected flag when corrections are made
   * - Logs all corrections and filtered items
   * - Returns filtered suggestions with reasons for UI display
   */
  private validateAndSanitizeSuggestions(
    parsed: { suggestions: PreferenceSuggestion[]; documentSummary: string },
    currentPreferences: Array<{ slug: string; value: any }>,
  ): {
    suggestions: PreferenceSuggestion[];
    filteredSuggestions: FilteredSuggestion[];
    documentSummary: string;
    filteredCount: number;
  } {
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
    const preferenceMap = new Map<string, any>();
    for (const pref of currentPreferences) {
      preferenceMap.set(pref.slug, pref.value);
    }

    const validatedSuggestions: PreferenceSuggestion[] = [];
    const filteredSuggestions: FilteredSuggestion[] = [];
    const seenSlugs = new Set<string>();

    for (const suggestion of parsed.suggestions) {
      // Filter: unknown slug
      if (!isKnownSlug(suggestion.slug)) {
        this.logger.warn(
          `Filtered suggestion: unknown slug "${suggestion.slug}"`,
        );
        filteredSuggestions.push({
          ...suggestion,
          filterReason: FilterReason.UNKNOWN_SLUG,
          filterDetails: `Slug "${suggestion.slug}" is not in the catalog`,
        });
        continue;
      }

      // Filter: missing required fields
      if (!suggestion.slug || suggestion.newValue === undefined) {
        const details = `slug: ${suggestion.slug}, newValue: ${suggestion.newValue}`;
        this.logger.warn(
          `Filtered suggestion: missing required field(s) - ${details}`,
        );
        filteredSuggestions.push({
          ...suggestion,
          filterReason: FilterReason.MISSING_FIELDS,
          filterDetails: details,
        });
        continue;
      }

      // Filter: duplicate slug (keep first)
      if (seenSlugs.has(suggestion.slug)) {
        this.logger.warn(
          `Filtered suggestion: duplicate slug ${suggestion.slug}`,
        );
        filteredSuggestions.push({
          ...suggestion,
          filterReason: FilterReason.DUPLICATE_KEY,
          filterDetails: `First occurrence of ${suggestion.slug} was already added`,
        });
        continue;
      }
      seenSlugs.add(suggestion.slug);

      // Check if preference exists in DB
      const existingValue = preferenceMap.get(suggestion.slug);
      const existsInDb = preferenceMap.has(suggestion.slug);
      let wasCorrected = false;

      // Correct operation type based on DB state
      const expectedOperation = existsInDb
        ? PreferenceOperation.UPDATE
        : PreferenceOperation.CREATE;

      if (suggestion.operation !== expectedOperation) {
        this.logger.warn(
          `Corrected operation for ${suggestion.slug}: AI said ${suggestion.operation}, but DB says ${expectedOperation}`,
        );
        suggestion.operation = expectedOperation;
        wasCorrected = true;
      }

      // Correct oldValue based on DB state
      if (existsInDb) {
        const actualOldValue = existingValue;
        const aiOldValue = suggestion.oldValue;

        // Check if oldValue matches (deep comparison for objects)
        const oldValueMatches =
          JSON.stringify(actualOldValue) === JSON.stringify(aiOldValue);

        if (!oldValueMatches) {
          this.logger.warn(
            `Corrected oldValue for ${suggestion.slug}: AI said ${JSON.stringify(aiOldValue)}, actual is ${JSON.stringify(actualOldValue)}`,
          );
          suggestion.oldValue = actualOldValue;
          wasCorrected = true;
        }
      } else if (
        suggestion.oldValue !== undefined &&
        suggestion.oldValue !== null
      ) {
        // CREATE operation shouldn't have oldValue
        this.logger.warn(
          `Corrected oldValue for ${suggestion.slug}: removed oldValue for CREATE operation`,
        );
        suggestion.oldValue = undefined;
        wasCorrected = true;
      }

      // Filter: UPDATE where newValue equals existing value (no change)
      if (
        existsInDb &&
        JSON.stringify(existingValue) === JSON.stringify(suggestion.newValue)
      ) {
        this.logger.warn(
          `Filtered suggestion: ${suggestion.slug} newValue matches existing value (no change)`,
        );
        filteredSuggestions.push({
          ...suggestion,
          filterReason: FilterReason.NO_CHANGE,
          filterDetails: `Value "${JSON.stringify(suggestion.newValue)}" already exists`,
        });
        continue;
      }

      suggestion.wasCorrected = wasCorrected;
      validatedSuggestions.push(suggestion);
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
}
