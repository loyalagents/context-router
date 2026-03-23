import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { PreferenceSearchAgent } from '@modules/agents/preferences/preference-search/preference-search.agent';

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

  constructor(
    private readonly agent: PreferenceSearchAgent,
    private readonly configService: ConfigService,
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

      const result = await this.agent.run({
        userId: context!.user.userId,
        naturalLanguageQuery: params.query,
        locationId: params.locationId,
        includeSuggestions: params.includeSuggestions,
        maxResults,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
