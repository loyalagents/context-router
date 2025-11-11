import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { McpContext } from '../types/mcp-context.type';

interface SearchPreferencesParams {
  category?: string;
  locationId?: string;
  globalOnly?: boolean;
}

@Injectable()
export class PreferenceSearchTool {
  private readonly logger = new Logger(PreferenceSearchTool.name);

  constructor(
    private preferenceService: PreferenceService,
    private configService: ConfigService,
  ) {}

  async search(params: SearchPreferencesParams, context: McpContext) {
    // TODO: MCP_SEARCH_AUTH - Phase 1 implementation
    // Extract userId from JWT context, NOT from params
    // This ensures users can only search their own preferences
    const userId = context.user.userId;

    const maxResults = this.configService.get(
      'mcp.tools.preferences.maxSearchResults',
    );

    this.logger.log(
      `Searching preferences for user ${userId} with params: ${JSON.stringify(params)}`,
    );

    try {
      let results;

      // Determine search strategy based on parameters
      if (params.globalOnly) {
        // Search only global preferences (not tied to a location)
        results = await this.preferenceService.findGlobalPreferences(userId);
      } else if (params.locationId) {
        // Search preferences for a specific location
        results = await this.preferenceService.findByLocation(
          userId,
          params.locationId,
        );
      } else if (params.category) {
        // Search preferences by category
        results = await this.preferenceService.findByCategory(
          userId,
          params.category,
        );
      } else {
        // No filters - return all user preferences
        results = await this.preferenceService.findAll(userId);
      }

      // Apply max results limit if configured
      if (maxResults && results.length > maxResults) {
        this.logger.warn(
          `Limiting results from ${results.length} to ${maxResults}`,
        );
        results = results.slice(0, maxResults);
      }

      this.logger.log(`Found ${results.length} preferences for user ${userId}`);

      return {
        success: true,
        count: results.length,
        preferences: results,
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
