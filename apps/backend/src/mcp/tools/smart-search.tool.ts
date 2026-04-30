import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { PreferenceSearchWorkflow } from '@modules/workflows/preferences/preference-search/preference-search.workflow';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';
import { McpToolExecutionResult } from '../access-log/access-log.types';
import {
  buildReadToolErrorResult,
  buildReadToolSuccessResult,
} from './base/read-tool-result.helper';

@Injectable()
export class SmartSearchTool implements McpToolInterface {
  private readonly logger = new Logger(SmartSearchTool.name);

  readonly descriptor: Tool = {
    name: 'smartSearchPreferences',
    description:
      'Map a natural-language task to relevant preference slugs, then return matching stored active or suggested preferences for the authenticated user. Use this when you do not know which slugs matter; it is not product search or web search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query describing what you are looking for',
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
      required: ['query'],
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
        matchedDefinitions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              description: { type: 'string' },
              category: { type: 'string' },
            },
          },
        },
        matchedActivePreferences: {
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
        matchedSuggestedPreferences: {
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
        queryInterpretation: {
          type: 'string',
        },
      },
      additionalProperties: true,
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = { resource: 'preferences', action: 'read' } as const;

  constructor(
    private readonly workflow: PreferenceSearchWorkflow,
    private readonly configService: ConfigService,
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<McpToolExecutionResult> {
    const params = args as {
      query: string;
      locationId?: string;
      includeSuggestions?: boolean;
    };

    try {
      const maxResults = this.configService.get<number>(
        'mcp.tools.preferences.maxSearchResults',
      );
      const filterAccessibleSlugs = (slugs: string[]) =>
        this.authorizationService.filterByTargetAccess(
          context!.client,
          this.requiredAccess,
          context!.grants,
          context!.user.userId,
          slugs,
        );

      const result = await this.workflow.run({
        userId: context!.user.userId,
        clientKey: context!.client.key,
        filterAccessibleSlugs,
        naturalLanguageQuery: params.query,
        locationId: params.locationId,
        includeSuggestions: params.includeSuggestions,
        maxResults,
      });

      const allowedSlugs = new Set(
        await filterAccessibleSlugs(
          [
            ...result.matchedDefinitions.map((definition) => definition.slug),
            ...result.matchedActivePreferences.map((pref) => pref.slug),
            ...result.matchedSuggestedPreferences.map((pref) => pref.slug),
          ],
        ),
      );

      const filteredResult = {
        ...result,
        matchedDefinitions: result.matchedDefinitions.filter((definition) =>
          allowedSlugs.has(definition.slug),
        ),
        matchedActivePreferences: result.matchedActivePreferences.filter((pref) =>
          allowedSlugs.has(pref.slug),
        ),
        matchedSuggestedPreferences:
          result.matchedSuggestedPreferences.filter((pref) =>
            allowedSlugs.has(pref.slug),
          ),
      };
      const structuredContent = {
        success: true as const,
        ...filteredResult,
      };

      return {
        result: buildReadToolSuccessResult(
          this.descriptor.name,
          `${filteredResult.matchedDefinitions.length} matched definitions, ${filteredResult.matchedActivePreferences.length} active preferences${params.includeSuggestions ? `, ${filteredResult.matchedSuggestedPreferences.length} suggested preferences` : ''}`,
          structuredContent,
        ),
        accessLog: {
          requestMetadata: {
            locationId: params.locationId ?? null,
            includeSuggestions: params.includeSuggestions === true,
            queryPresent: Boolean(params.query),
            queryLength: params.query?.length ?? 0,
          },
          responseMetadata: {
            matchedDefinitionCount: filteredResult.matchedDefinitions.length,
            matchedActiveCount:
              filteredResult.matchedActivePreferences.length,
            matchedSuggestedCount:
              filteredResult.matchedSuggestedPreferences.length,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Smart search failed for user ${context?.user?.userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
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
}
