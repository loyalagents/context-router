import { Injectable, Logger } from '@nestjs/common';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { McpContext } from '../types/mcp-context.type';
import {
  isKnownSlug,
  findSimilarSlugs,
  getDefinition,
  PREFERENCE_CATALOG,
} from '@config/preferences.catalog';

/**
 * Parameters for suggesting a preference via MCP.
 * Note: MCP writes are ALWAYS suggestions - they never write ACTIVE directly.
 */
interface SuggestPreferenceParams {
  slug: string;
  value: string; // JSON string that will be parsed
  locationId?: string;
  confidence: number;
  evidence?: string; // JSON string for evidence metadata
}

interface DeletePreferenceParams {
  id: string;
}

/**
 * Parse a JSON string value from MCP tool input.
 * Returns the parsed value or throws a descriptive error.
 */
function parseJsonValue(value: string, context: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(
      `Invalid JSON in ${context}: "${value}". ` +
        `Expected a valid JSON string like '["item1", "item2"]' for arrays, ` +
        `'{"key": "value"}' for objects, or '"text"' for strings.`,
    );
  }
}

/**
 * Validates a slug and returns an error message if invalid.
 */
function validateSlug(slug: string): string | null {
  if (!isKnownSlug(slug)) {
    const similar = findSimilarSlugs(slug);
    const allSlugs = Object.keys(PREFERENCE_CATALOG);

    if (similar.length > 0) {
      return `Unknown slug "${slug}". Did you mean: ${similar.join(', ')}? Valid slugs are: ${allSlugs.join(', ')}`;
    }
    return `Unknown slug "${slug}". Valid slugs are: ${allSlugs.join(', ')}`;
  }
  return null;
}

@Injectable()
export class PreferenceMutationTool {
  private readonly logger = new Logger(PreferenceMutationTool.name);

  constructor(private preferenceService: PreferenceService) {}

  /**
   * Suggest a preference. MCP writes are ALWAYS suggestions.
   * They never write ACTIVE directly - only humans can confirm preferences.
   */
  async suggest(params: SuggestPreferenceParams, context: McpContext) {
    const userId = context.user.userId;

    this.logger.log(
      `Suggesting preference for user ${userId}: ${params.slug}`,
    );

    try {
      // Validate slug
      const slugError = validateSlug(params.slug);
      if (slugError) {
        return {
          success: false,
          error: slugError,
        };
      }

      // Parse the JSON string value from MCP input
      const parsedValue = parseJsonValue(params.value, 'value');

      // Parse evidence if provided
      let parsedEvidence: unknown = undefined;
      if (params.evidence) {
        parsedEvidence = parseJsonValue(params.evidence, 'evidence');
      }

      // Validate confidence
      if (
        typeof params.confidence !== 'number' ||
        params.confidence < 0 ||
        params.confidence > 1
      ) {
        return {
          success: false,
          error: 'Confidence must be a number between 0 and 1',
        };
      }

      const preference = await this.preferenceService.suggestPreference(
        userId,
        {
          slug: params.slug,
          value: parsedValue,
          locationId: params.locationId,
          confidence: params.confidence,
          evidence: parsedEvidence,
        },
      );

      // If preference is null, it means the user previously rejected this preference
      if (preference === null) {
        return {
          success: true,
          skipped: true,
          message: `Suggestion skipped: user previously rejected preference "${params.slug}"`,
        };
      }

      this.logger.log(`Preference suggested successfully: ${preference.id}`);

      // Get definition for response enrichment
      const def = getDefinition(params.slug);

      return {
        success: true,
        preference: {
          id: preference.id,
          slug: preference.slug,
          value: preference.value,
          status: preference.status,
          confidence: preference.confidence,
          category: def?.category,
          description: def?.description,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error suggesting preference for user ${userId}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete a preference by ID.
   */
  async delete(params: DeletePreferenceParams, context: McpContext) {
    const userId = context.user.userId;

    this.logger.log(`Deleting preference ${params.id} for user ${userId}`);

    try {
      const preference = await this.preferenceService.deletePreference(
        params.id,
        userId,
      );

      this.logger.log(`Preference deleted successfully: ${preference.id}`);

      return {
        success: true,
        deletedId: preference.id,
      };
    } catch (error) {
      this.logger.error(
        `Error deleting preference ${params.id} for user ${userId}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }
}
