import { Injectable, Logger } from "@nestjs/common";
import { PreferenceService } from "@modules/preferences/preference/preference.service";
import { McpContext } from "../types/mcp-context.type";

/**
 * Shared MCP write parameters for preference suggestions and direct applies.
 */
interface WritePreferenceParams {
  slug: string;
  value: string; // JSON string that will be parsed
  locationId?: string;
  confidence: number;
  evidence?: string; // JSON string for evidence metadata
}

type SuggestPreferenceParams = WritePreferenceParams;
type ApplyPreferenceParams = WritePreferenceParams;

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
    const schemaNamespace = context.user.schemaNamespace;

    if (!params?.slug) {
      return {
        success: false,
        error: "slug is required",
      };
    }

    if (typeof params.value !== "string") {
      return {
        success: false,
        error: "value must be provided as a JSON string",
      };
    }

    this.logger.log(`Suggesting preference for user ${userId}: ${params.slug}`);

    try {
      // Parse the JSON string value from MCP input
      const parsedValue = parseJsonValue(params.value, "value");

      // Parse evidence if provided
      let parsedEvidence: unknown = undefined;
      if (params.evidence) {
        parsedEvidence = parseJsonValue(params.evidence, "evidence");
      }

      // Validate confidence
      if (
        typeof params.confidence !== "number" ||
        params.confidence < 0 ||
        params.confidence > 1
      ) {
        return {
          success: false,
          error: "Confidence must be a number between 0 and 1",
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
        schemaNamespace,
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

      return {
        success: true,
        preference: {
          id: preference.id,
          slug: preference.slug,
          value: preference.value,
          status: preference.status,
          sourceType: preference.sourceType,
          confidence: preference.confidence,
          category: preference.slug.split(".")[0],
          description: preference.description,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error suggesting preference for user ${userId}: ${error.message}`,
        error.stack,
      );

      if (
        typeof error.message === 'string' &&
        error.message.includes('Unknown preference slug')
      ) {
        return {
          success: false,
          error: error.message,
          code: 'UNKNOWN_PREFERENCE_SLUG',
          message: error.message,
          suggestedTool: 'createPreferenceDefinition',
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Apply a preference directly as ACTIVE while preserving agent provenance.
   */
  async apply(params: ApplyPreferenceParams, context: McpContext) {
    const userId = context.user.userId;
    const schemaNamespace = context.user.schemaNamespace;

    if (!params?.slug) {
      return {
        success: false,
        error: "slug is required",
      };
    }

    if (typeof params.value !== "string") {
      return {
        success: false,
        error: "value must be provided as a JSON string",
      };
    }

    this.logger.log(`Applying preference for user ${userId}: ${params.slug}`);

    try {
      const parsedValue = parseJsonValue(params.value, "value");

      let parsedEvidence: unknown = undefined;
      if (params.evidence) {
        parsedEvidence = parseJsonValue(params.evidence, "evidence");
      }

      if (
        typeof params.confidence !== "number" ||
        params.confidence < 0 ||
        params.confidence > 1
      ) {
        return {
          success: false,
          error: "Confidence must be a number between 0 and 1",
        };
      }

      const result = await this.preferenceService.applyPreference(
        userId,
        {
          slug: params.slug,
          value: parsedValue,
          locationId: params.locationId,
          confidence: params.confidence,
          evidence: parsedEvidence,
        },
        schemaNamespace,
      );

      if (!("preference" in result)) {
        return {
          success: false,
          code: result.code,
          error: "Preference was previously rejected for this scope",
          message: result.message,
        };
      } else {
        const preference = result.preference;

        this.logger.log(`Preference applied successfully: ${preference.id}`);

        return {
          success: true,
          clearedSuggestion: result.deletedSuggestion,
          preference: {
            id: preference.id,
            slug: preference.slug,
            value: preference.value,
            status: preference.status,
            sourceType: preference.sourceType,
            confidence: preference.confidence,
            category: preference.slug.split(".")[0],
            description: preference.description,
            locationId: preference.locationId,
          },
        };
      }
    } catch (error) {
      this.logger.error(
        `Error applying preference for user ${userId}: ${error.message}`,
        error.stack,
      );

      if (
        typeof error.message === "string" &&
        error.message.includes("Unknown preference slug")
      ) {
        return {
          success: false,
          error: error.message,
          code: "UNKNOWN_PREFERENCE_SLUG",
          message: error.message,
          suggestedTool: "createPreferenceDefinition",
        };
      }

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

    if (!params?.id) {
      return {
        success: false,
        error: "id is required",
      };
    }

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
