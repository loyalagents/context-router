import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PreferenceService } from "@modules/preferences/preference/preference.service";
import { McpContext } from "../types/mcp-context.type";
import { PreferenceDefinitionRepository } from "@modules/preferences/preference-definition/preference-definition.repository";

interface SearchPreferencesParams {
  query?: string; // Search by slug prefix, category, or description keyword
  category?: string; // Deprecated alias for category-based lookup
  locationId?: string;
  includeSuggestions?: boolean; // Whether to include SUGGESTED preferences
}

@Injectable()
export class PreferenceSearchTool {
  private readonly logger = new Logger(PreferenceSearchTool.name);

  constructor(
    private preferenceService: PreferenceService,
    private configService: ConfigService,
    private defRepo: PreferenceDefinitionRepository,
  ) {}

  /**
   * Search the catalog for matching slugs based on query.
   */
  private async searchCatalog(
    query: string,
    userId: string,
  ): Promise<string[]> {
    const normalized = query.toLowerCase();
    const defs = await this.defRepo.getAll(userId);

    return defs
      .filter((def) => {
        const category = def.slug.split(".")[0];
        if (def.slug.startsWith(normalized)) return true;
        if (category.includes(normalized)) return true;
        if (def.description.toLowerCase().includes(normalized)) return true;
        return false;
      })
      .map((d) => d.slug);
  }

  async search(params: SearchPreferencesParams, context: McpContext) {
    const userId = context.user.userId;
    const effectiveQuery = params.query ?? params.category;

    const maxResults = this.configService.get(
      "mcp.tools.preferences.maxSearchResults",
    );

    this.logger.log(
      `Searching preferences for user ${userId} with params: ${JSON.stringify(params)}`,
    );

    try {
      // Get active preferences
      const activePrefs = await this.preferenceService.getActivePreferences(
        userId,
        params.locationId,
      );

      // If query is provided, filter by matching slugs
      let filteredActive = activePrefs;
      if (effectiveQuery) {
        const matchingSlugs = new Set(
          await this.searchCatalog(effectiveQuery, userId),
        );
        filteredActive = activePrefs.filter((p) => matchingSlugs.has(p.slug));
      }

      // Optionally include suggestions
      let suggestions: typeof activePrefs = [];
      if (params.includeSuggestions) {
        const suggestedPrefs =
          await this.preferenceService.getSuggestedPreferences(
            userId,
            params.locationId,
          );

        if (effectiveQuery) {
          const matchingSlugs = new Set(
            await this.searchCatalog(effectiveQuery, userId),
          );
          suggestions = suggestedPrefs.filter((p) => matchingSlugs.has(p.slug));
        } else {
          suggestions = suggestedPrefs;
        }
      }

      // Apply max results limit
      if (maxResults) {
        if (filteredActive.length > maxResults) {
          this.logger.warn(
            `Limiting active results from ${filteredActive.length} to ${maxResults}`,
          );
          filteredActive = filteredActive.slice(0, maxResults);
        }
        if (suggestions.length > maxResults) {
          this.logger.warn(
            `Limiting suggestion results from ${suggestions.length} to ${maxResults}`,
          );
          suggestions = suggestions.slice(0, maxResults);
        }
      }

      // Format results — slug and description come from the enriched preference join
      const formatPreference = (pref: (typeof activePrefs)[0]) => ({
        id: pref.id,
        slug: pref.slug,
        value: pref.value,
        status: pref.status,
        sourceType: pref.sourceType,
        confidence: pref.confidence,
        locationId: pref.locationId,
        updatedAt: pref.updatedAt,
        category: pref.slug.split(".")[0],
        description: pref.description,
      });

      this.logger.log(
        `Found ${filteredActive.length} active, ${suggestions.length} suggested for user ${userId}`,
      );

      return {
        success: true,
        active: {
          count: filteredActive.length,
          preferences: filteredActive.map(formatPreference),
        },
        ...(params.includeSuggestions && {
          suggested: {
            count: suggestions.length,
            preferences: suggestions.map(formatPreference),
          },
        }),
      };
    } catch (error) {
      this.logger.error(
        `Error searching preferences for user ${userId}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }
}
