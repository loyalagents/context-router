import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { PreferenceDefinitionRepository } from '@modules/preferences/preference-definition/preference-definition.repository';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';

interface SearchPreferencesParams {
  query?: string;
  locationId?: string;
  includeSuggestions?: boolean;
}

@Injectable()
export class PreferenceSearchTool implements McpToolInterface {
  private readonly logger = new Logger(PreferenceSearchTool.name);

  readonly descriptor: Tool = {
    name: 'searchPreferences',
    description:
      'Search user preferences by query, location, or retrieve all active preferences. Returns preferences scoped to the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search by slug prefix, category, or description keyword',
        },
        locationId: {
          type: 'string',
          description:
            'Include preferences for this location (merged with global)',
        },
        includeSuggestions: {
          type: 'boolean',
          description:
            'If true, also return SUGGESTED preferences (inbox)',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = { resource: 'preferences', action: 'read' } as const;

  constructor(
    private preferenceService: PreferenceService,
    private configService: ConfigService,
    private defRepo: PreferenceDefinitionRepository,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    try {
      const result = await this.search(
        args as SearchPreferencesParams,
        context!,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ error: error.message }, null, 2) },
        ],
        isError: true,
      };
    }
  }

  private async searchCatalog(
    query: string,
    userId: string,
  ): Promise<string[]> {
    const normalized = query.toLowerCase();
    const defs = await this.defRepo.getAll(userId);

    return defs
      .filter((def) => {
        const category = def.slug.split('.')[0];
        if (def.slug.startsWith(normalized)) return true;
        if (category.includes(normalized)) return true;
        if (def.description.toLowerCase().includes(normalized)) return true;
        return false;
      })
      .map((d) => d.slug);
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
      const activePrefs = await this.preferenceService.getActivePreferences(
        userId,
        params.locationId,
      );

      let filteredActive = activePrefs;
      if (params.query) {
        const matchingSlugs = new Set(
          await this.searchCatalog(params.query, userId),
        );
        filteredActive = activePrefs.filter((p) => matchingSlugs.has(p.slug));
      }

      let suggestions: typeof activePrefs = [];
      if (params.includeSuggestions) {
        const suggestedPrefs =
          await this.preferenceService.getSuggestedPreferences(
            userId,
            params.locationId,
          );

        if (params.query) {
          const matchingSlugs = new Set(
            await this.searchCatalog(params.query, userId),
          );
          suggestions = suggestedPrefs.filter((p) =>
            matchingSlugs.has(p.slug),
          );
        } else {
          suggestions = suggestedPrefs;
        }
      }

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

      const formatPreference = (pref: (typeof activePrefs)[0]) => ({
        id: pref.id,
        slug: pref.slug,
        value: pref.value,
        status: pref.status,
        sourceType: pref.sourceType,
        confidence: pref.confidence,
        locationId: pref.locationId,
        updatedAt: pref.updatedAt,
        category: pref.slug.split('.')[0],
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
      return { success: false, error: error.message };
    }
  }
}
