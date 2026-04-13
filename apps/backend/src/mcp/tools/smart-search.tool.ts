import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { PreferenceSearchWorkflow } from '@modules/workflows/preferences/preference-search/preference-search.workflow';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';

@Injectable()
export class SmartSearchTool implements McpToolInterface {
  private readonly logger = new Logger(SmartSearchTool.name);

  readonly descriptor: Tool = {
    name: 'smartSearchPreferences',
    description:
      'Natural-language preference search. Understands intent rather than keywords.',
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
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = { resource: 'preferences', action: 'read' } as const;

  constructor(
    private readonly workflow: PreferenceSearchWorkflow,
    private readonly configService: ConfigService,
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
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
        schemaNamespace: context!.user.schemaNamespace,
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

      return {
        content: [
          { type: 'text', text: JSON.stringify(filteredResult, null, 2) },
        ],
      };
    } catch (error) {
      this.logger.error(
        `Smart search failed for user ${context?.user?.userId}: ${error.message}`,
        error.stack,
      );
      return {
        content: [
          { type: 'text', text: JSON.stringify({ error: error.message }, null, 2) },
        ],
        isError: true,
      };
    }
  }
}
