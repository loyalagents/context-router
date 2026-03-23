import { Injectable } from '@nestjs/common';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { PreferenceMutationTool } from './preference-mutation.tool';

@Injectable()
export class PreferenceSuggestTool implements McpToolInterface {
  readonly descriptor: Tool = {
    name: 'suggestPreference',
    description:
      'Suggest a preference value for the user. This creates a SUGGESTED preference that the user must approve in the UI. Use listPreferenceSlugs first to find valid slugs. If the user previously rejected this preference, the suggestion will be skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description:
            'Preference slug from the catalog (e.g., "food.dietary_restrictions")',
        },
        value: {
          type: 'string',
          description:
            'Preference value as JSON string. Examples: \'["peanuts", "shellfish"]\' for arrays, \'"casual"\' for enum strings',
        },
        confidence: {
          type: 'number',
          description:
            'Confidence score between 0 and 1 (e.g., 0.85 for high confidence)',
        },
        locationId: {
          type: 'string',
          description:
            'Optional location ID for location-scoped preferences',
        },
        evidence: {
          type: 'string',
          description:
            'Optional JSON string with evidence metadata (messageIds, snippets, reason)',
        },
      },
      required: ['slug', 'value', 'confidence'],
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };

  readonly requiresAuth = true;

  constructor(private readonly mutationTool: PreferenceMutationTool) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    try {
      const result = await this.mutationTool.suggest(args as any, context!);
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
}
