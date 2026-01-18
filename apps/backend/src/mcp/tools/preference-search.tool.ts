import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { McpContext } from '../types/mcp-context.type';
import {
  PREFERENCE_CATALOG,
  getDefinition,
  getAllSlugs,
  getSlugsByCategory,
} from '@config/preferences.catalog';

interface SearchPreferencesParams {
  query?: string; // Search by slug prefix, category, or description keyword
  locationId?: string;
  includeSuggestions?: boolean; // Whether to include SUGGESTED preferences
}

@Injectable()
export class PreferenceSearchTool {
  private readonly logger = new Logger(PreferenceSearchTool.name);

  constructor(
    private preferenceService: PreferenceService,
    private configService: ConfigService,
  ) {}

  /**
   * Search the catalog for matching slugs based on query.
   */
  private searchCatalog(query: string): string[] {
    const normalized = query.toLowerCase();
    const allSlugs = getAllSlugs();

    return allSlugs.filter((slug) => {
      // Match by slug prefix
      if (slug.startsWith(normalized)) return true;

      // Match by category
      const def = getDefinition(slug);
      if (def?.category.includes(normalized)) return true;

      // Match by description keyword
      if (def?.description.toLowerCase().includes(normalized)) return true;

      return false;
    });
  }

  async search(params: SearchPreferencesParams, context: McpContext) {
    const userId = context.user.userId;

    const maxResults = this.configService.get(
      'mcp.tools.preferences.maxSearchResults',
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
      if (params.query) {
        const matchingSlugs = new Set(this.searchCatalog(params.query));
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

        if (params.query) {
          const matchingSlugs = new Set(this.searchCatalog(params.query));
          suggestions = suggestedPrefs.filter((p) =>
            matchingSlugs.has(p.slug),
          );
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

      // Format results with catalog metadata
      const formatPreference = (pref: (typeof activePrefs)[0]) => {
        const def = getDefinition(pref.slug);
        return {
          id: pref.id,
          slug: pref.slug,
          value: pref.value,
          status: pref.status,
          sourceType: pref.sourceType,
          confidence: pref.confidence,
          locationId: pref.locationId,
          updatedAt: pref.updatedAt,
          category: def?.category,
          description: def?.description,
        };
      };

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
