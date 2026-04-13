import { Injectable } from '@nestjs/common';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { PreferenceMutationTool } from './preference-mutation.tool';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';

@Injectable()
export class PreferenceApplyTool implements McpToolInterface {
  readonly descriptor: Tool = {
    name: 'applyPreference',
    description:
      'Apply a preference value directly as ACTIVE for the user. This bypasses UI review, stores AGENT provenance on the active preference, and clears any matching pending suggestion. If the user previously rejected this preference for the same scope, the apply is blocked.',
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
            'Informational confidence score between 0 and 1. Stored for audit/provenance only; not used as an apply threshold.',
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
  readonly requiredAccess = {
    resource: 'preferences',
    action: 'write',
  } as const;

  constructor(
    private readonly mutationTool: PreferenceMutationTool,
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    try {
      const params = args as { slug: string };
      await this.authorizationService.assertAccessTarget(
        context!.client,
        this.requiredAccess,
        context!.grants,
        context!.user.userId,
        'tools/call',
        { slug: params.slug },
      );

      const result = await this.mutationTool.apply(args as any, context!);
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
