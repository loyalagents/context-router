import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PreferenceService } from "@modules/preferences/preference/preference.service";
import { PreferenceDefinitionRepository } from "@modules/preferences/preference-definition/preference-definition.repository";
import { McpContext } from "../types/mcp-context.type";
import { McpToolInterface } from "./base/mcp-tool.interface";
import { McpAuthorizationService } from '../auth/mcp-authorization.service';

interface SearchPreferencesParams {
  query?: string;
  category?: string; // Deprecated alias for category-based lookup
  locationId?: string;
  includeSuggestions?: boolean;
}

@Injectable()
export class PreferenceSearchTool implements McpToolInterface {
  private readonly logger = new Logger(PreferenceSearchTool.name);

  readonly descriptor: Tool = {
    name: "searchPreferences",
    description:
      "Search user preferences by query, category, location, or retrieve all active preferences. Returns preferences scoped to the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search by slug prefix, category, or description keyword",
        },
        category: {
          type: "string",
          description:
            "Deprecated alias for query. Filters by preference category.",
        },
        locationId: {
          type: "string",
          description:
            "Include preferences for this location (merged with global)",
        },
        includeSuggestions: {
          type: "boolean",
          description:
            "If true, also return SUGGESTED preferences (inbox)",
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
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    try {
      const result = await this.search(
        args as SearchPreferencesParams,
        context!,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Search the catalog for matching slugs based on query.
   */
  private async searchCatalog(
    query: string,
    userId: string,
    schemaNamespace?: string,
  ): Promise<string[]> {
    const normalized = query.toLowerCase();
    const defs = await this.defRepo.getAll(userId, schemaNamespace);

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
    const schemaNamespace = context.user.schemaNamespace;
    const effectiveQuery = params.query ?? params.category;

    const maxResults = this.configService.get(
      "mcp.tools.preferences.maxSearchResults",
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
      if (effectiveQuery) {
        const matchingSlugs = new Set(
          await this.searchCatalog(effectiveQuery, userId, schemaNamespace),
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

        if (effectiveQuery) {
          const matchingSlugs = new Set(
            await this.searchCatalog(effectiveQuery, userId, schemaNamespace),
          );
          suggestions = suggestedPrefs.filter((p) =>
            matchingSlugs.has(p.slug),
          );
        } else {
          suggestions = suggestedPrefs;
        }
      }

      const allCandidateSlugs = Array.from(
        new Set([
          ...filteredActive.map((pref) => pref.slug),
          ...suggestions.map((pref) => pref.slug),
        ]),
      );
      const allowedSlugs = new Set(
        await this.authorizationService.filterByTargetAccess(
          context.client,
          this.requiredAccess,
          context.grants,
          userId,
          allCandidateSlugs,
        ),
      );

      filteredActive = filteredActive.filter((pref) =>
        allowedSlugs.has(pref.slug),
      );
      suggestions = suggestions.filter((pref) => allowedSlugs.has(pref.slug));

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
      return { success: false, error: error.message };
    }
  }
}
