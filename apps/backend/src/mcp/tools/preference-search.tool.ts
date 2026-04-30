import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { PreferenceDefinitionRepository } from '@modules/preferences/preference-definition/preference-definition.repository';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';
import { McpToolExecutionResult } from '../access-log/access-log.types';
import {
  buildReadToolErrorResult,
  buildReadToolSuccessResult,
} from './base/read-tool-result.helper';

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
      'Retrieve stored user preferences using literal catalog matching. Omit query to return all active preferences for the user; provide query to filter by slug prefix, category, or definition description keyword. This is not semantic search.',
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
    outputSchema: {
      type: 'object',
      required: ['success'],
      properties: {
        success: {
          type: 'boolean',
        },
        error: {
          type: 'string',
        },
        active: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            preferences: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  slug: { type: 'string' },
                  value: {},
                  status: { type: 'string' },
                  sourceType: { type: 'string' },
                  confidence: { type: 'number' },
                  locationId: {
                    anyOf: [{ type: 'string' }, { type: 'null' }],
                  },
                  updatedAt: { type: 'string' },
                  category: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        suggested: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            preferences: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  slug: { type: 'string' },
                  value: {},
                  status: { type: 'string' },
                  sourceType: { type: 'string' },
                  confidence: { type: 'number' },
                  locationId: {
                    anyOf: [{ type: 'string' }, { type: 'null' }],
                  },
                  updatedAt: { type: 'string' },
                  category: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
      },
      additionalProperties: true,
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

  async execute(args: unknown, context?: McpContext): Promise<McpToolExecutionResult> {
    const params = args as SearchPreferencesParams;
    try {
      const result = await this.search(params, context!);
      const activeCount = result.active.count;
      const suggestedCount = result.suggested?.count ?? 0;

      return {
        result: buildReadToolSuccessResult(
          this.descriptor.name,
          `${activeCount} active preferences${params.includeSuggestions ? `, ${suggestedCount} suggested preferences` : ''}`,
          result,
        ),
        accessLog: {
          requestMetadata: {
            locationId: params.locationId ?? null,
            includeSuggestions: params.includeSuggestions === true,
            queryPresent: Boolean(params.query),
            queryLength: params.query?.length ?? 0,
          },
          responseMetadata: {
            activeCount,
            suggestedCount,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: buildReadToolErrorResult(this.descriptor.name, message),
        accessLog: {
          requestMetadata: {
            locationId: params.locationId ?? null,
            includeSuggestions: params.includeSuggestions === true,
            queryPresent: Boolean(params.query),
            queryLength: params.query?.length ?? 0,
          },
          errorMetadata: {
            message,
          },
        },
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

    const activePrefs = await this.preferenceService.getActivePreferences(
      userId,
      params.locationId,
    );

    let filteredActive = activePrefs;
    if (params.query) {
      const matchingSlugs = new Set(await this.searchCatalog(params.query, userId));
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
        suggestions = suggestedPrefs.filter((p) => matchingSlugs.has(p.slug));
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

    filteredActive = filteredActive.filter((pref) => allowedSlugs.has(pref.slug));
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
      category: pref.slug.split('.')[0],
      description: pref.description,
    });

    this.logger.log(
      `Found ${filteredActive.length} active, ${suggestions.length} suggested for user ${userId}`,
    );

    return {
      success: true as const,
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
  }
}
