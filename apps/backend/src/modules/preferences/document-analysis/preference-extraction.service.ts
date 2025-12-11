import { Injectable, Inject, Logger } from '@nestjs/common';
import { AiTextGeneratorPort } from '../../../domains/shared/ports/ai-text-generator.port';
import { PreferenceService } from '../preference/preference.service';
import {
  PreferenceSuggestion,
  PreferenceOperation,
  FilteredSuggestion,
  FilterReason,
} from './dto/preference-suggestion.dto';
import { getDocumentUploadConfig } from '../../../config/document-upload.config';

/**
 * Preference Schema Definition
 *
 * This defines the categories and keys that the AI will use when extracting preferences.
 * UPDATE THIS LIST when you add new preference categories/keys to the system.
 *
 * Format: { category: [keys] }
 */
const PREFERENCE_SCHEMA: Record<string, string[]> = {
  // Dietary preferences and restrictions
  dietary: [
    'allergies', // Food allergies (e.g., nuts, shellfish, dairy)
    'intolerances', // Food intolerances (e.g., lactose, gluten)
    'diet_type', // Dietary lifestyle (e.g., vegetarian, vegan, keto, paleo)
    'restrictions', // Religious/cultural restrictions (e.g., halal, kosher)
    'dislikes', // Foods the user dislikes
    'favorites', // Favorite foods or cuisines
  ],
  // Travel preferences
  travel: [
    'seat_preference', // Airplane seat (window, aisle, middle)
    'class_preference', // Travel class (economy, business, first)
    'hotel_amenities', // Must-have hotel amenities
    'airline_loyalty', // Preferred airlines or loyalty programs
    'hotel_loyalty', // Preferred hotel chains or loyalty programs
  ],
  // Communication preferences
  communication: [
    'preferred_language', // Preferred language for communication
    'contact_method', // Preferred contact method (email, phone, text)
    'notification_frequency', // How often to receive notifications
  ],
  // Accessibility needs
  accessibility: [
    'mobility', // Mobility requirements
    'visual', // Visual accommodations
    'auditory', // Hearing accommodations
    'other', // Other accessibility needs
  ],
  // General preferences
  general: [
    'timezone', // Preferred timezone
    'currency', // Preferred currency
    'units', // Measurement units (metric, imperial)
  ],
};

interface AiSuggestionResponse {
  suggestions: Array<{
    key: string;
    category: string;
    operation: 'CREATE' | 'UPDATE';
    oldValue?: any;
    newValue: any;
    confidence: number;
    sourceSnippet: string;
    sourceMeta?: {
      page?: number;
      line?: number;
    };
  }>;
  documentSummary: string;
}

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
    // Fetch user's current preferences
    const currentPreferences = await this.preferenceService.findAll(userId);

    // Build the prompt
    const prompt = this.buildExtractionPrompt(currentPreferences, filename);

    this.logger.log(`Calling AI for preference extraction from ${filename}`);

    // Call the AI with the file
    const aiResponse = await this.aiService.generateTextWithFile(prompt, {
      buffer: fileBuffer,
      mimeType,
    });

    // Parse and validate the response
    const parsed = this.parseAiResponse(aiResponse, userId);
    return this.validateAndSanitizeSuggestions(parsed, currentPreferences);
  }

  private buildExtractionPrompt(
    currentPreferences: Array<{ category: string; key: string; value: any }>,
    filename: string,
  ): string {
    const schemaJson = JSON.stringify(PREFERENCE_SCHEMA, null, 2);
    const currentPreferencesJson = JSON.stringify(
      currentPreferences.map((p) => ({
        category: p.category,
        key: p.key,
        value: p.value,
      })),
      null,
      2,
    );

    return `You are a data extraction assistant that reads documents and proposes preference changes for a user.

Here is the user's current preference schema (categories and keys):
${schemaJson}

Here are the user's current preferences:
${currentPreferencesJson}

The document "${filename}" is attached above.

Task:
- Analyze the attached document for any information that indicates a new or updated preference.
- For each item, output a suggestion object.
- Only suggest changes with clear evidence in the document.
- Return at most ${this.config.maxSuggestions} suggestions, prioritizing higher-confidence items.
- Use existing categories and keys from the schema when possible.
- If a preference already exists with the same value, do not include it.
- For UPDATE operations, include the oldValue from current preferences.

Respond with JSON only (no markdown code blocks):
{
  "suggestions": [
    {
      "key": "string",
      "category": "string",
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
    try {
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

      const parsed: AiSuggestionResponse = JSON.parse(cleanResponse);

      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        this.logger.warn('AI response missing suggestions array');
        return { suggestions: [], documentSummary: parsed.documentSummary || '' };
      }

      const suggestions: PreferenceSuggestion[] = parsed.suggestions
        .slice(0, this.config.maxSuggestions)
        .map((s, index) => ({
          id: `${analysisId}:${index}`,
          category: s.category,
          key: s.key,
          operation:
            s.operation === 'UPDATE'
              ? PreferenceOperation.UPDATE
              : PreferenceOperation.CREATE,
          oldValue: s.oldValue,
          newValue: s.newValue,
          confidence: Math.min(1, Math.max(0, s.confidence || 0.5)),
          sourceSnippet: s.sourceSnippet || '',
          sourceMeta: s.sourceMeta
            ? {
                page: s.sourceMeta.page,
                line: s.sourceMeta.line,
              }
            : undefined,
          wasCorrected: false,
        }));

      return {
        suggestions,
        documentSummary: parsed.documentSummary || '',
      };
    } catch (error) {
      this.logger.error('Failed to parse AI response', error);
      this.logger.debug(`Raw AI response: ${aiResponse}`);
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Validates and sanitizes AI-generated suggestions against actual DB state.
   *
   * - Filters out suggestions missing required fields (category, key, newValue)
   * - Corrects operation type (CREATE vs UPDATE) based on DB state
   * - Corrects oldValue with actual DB value if exists
   * - Deduplicates by category/key (keeps first occurrence)
   * - Sets wasCorrected flag when corrections are made
   * - Logs all corrections and filtered items
   * - Returns filtered suggestions with reasons for UI display
   */
  private validateAndSanitizeSuggestions(
    parsed: { suggestions: PreferenceSuggestion[]; documentSummary: string },
    currentPreferences: Array<{ category: string; key: string; value: any }>,
  ): {
    suggestions: PreferenceSuggestion[];
    filteredSuggestions: FilteredSuggestion[];
    documentSummary: string;
    filteredCount: number;
  } {
    // DEBUG: Log all suggestions found by AI
    this.logger.debug(
      `AI found ${parsed.suggestions.length} raw suggestions: ${JSON.stringify(
        parsed.suggestions.map((s) => ({
          category: s.category,
          key: s.key,
          operation: s.operation,
          newValue: s.newValue,
          confidence: s.confidence,
        })),
        null,
        2,
      )}`,
    );

    // Build a lookup map for current preferences
    const preferenceMap = new Map<string, any>();
    for (const pref of currentPreferences) {
      preferenceMap.set(`${pref.category}/${pref.key}`, pref.value);
    }

    const validatedSuggestions: PreferenceSuggestion[] = [];
    const filteredSuggestions: FilteredSuggestion[] = [];
    const seenKeys = new Set<string>();

    for (const suggestion of parsed.suggestions) {
      const prefKey = `${suggestion.category}/${suggestion.key}`;

      // Filter: missing required fields
      if (!suggestion.category || !suggestion.key || suggestion.newValue === undefined) {
        const details = `category: ${suggestion.category}, key: ${suggestion.key}, newValue: ${suggestion.newValue}`;
        this.logger.warn(`Filtered suggestion: missing required field(s) - ${details}`);
        filteredSuggestions.push({
          ...suggestion,
          filterReason: FilterReason.MISSING_FIELDS,
          filterDetails: details,
        });
        continue;
      }

      // Filter: duplicate category/key (keep first)
      if (seenKeys.has(prefKey)) {
        this.logger.warn(`Filtered suggestion: duplicate key ${prefKey}`);
        filteredSuggestions.push({
          ...suggestion,
          filterReason: FilterReason.DUPLICATE_KEY,
          filterDetails: `First occurrence of ${prefKey} was already added`,
        });
        continue;
      }
      seenKeys.add(prefKey);

      // Check if preference exists in DB
      const existingValue = preferenceMap.get(prefKey);
      const existsInDb = preferenceMap.has(prefKey);
      let wasCorrected = false;

      // Correct operation type based on DB state
      const expectedOperation = existsInDb
        ? PreferenceOperation.UPDATE
        : PreferenceOperation.CREATE;

      if (suggestion.operation !== expectedOperation) {
        this.logger.warn(
          `Corrected operation for ${prefKey}: AI said ${suggestion.operation}, but DB says ${expectedOperation}`,
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
            `Corrected oldValue for ${prefKey}: AI said ${JSON.stringify(aiOldValue)}, actual is ${JSON.stringify(actualOldValue)}`,
          );
          suggestion.oldValue = actualOldValue;
          wasCorrected = true;
        }
      } else if (suggestion.oldValue !== undefined && suggestion.oldValue !== null) {
        // CREATE operation shouldn't have oldValue
        this.logger.warn(
          `Corrected oldValue for ${prefKey}: removed oldValue for CREATE operation`,
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
          `Filtered suggestion: ${prefKey} newValue matches existing value (no change)`,
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
