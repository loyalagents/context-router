import { Injectable } from '@nestjs/common';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { PreferenceMutationTool } from './preference-mutation.tool';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';

@Injectable()
export class PreferenceDeleteTool implements McpToolInterface {
  readonly descriptor: Tool = {
    name: 'deletePreference',
    description:
      'Delete a preference. Only the authenticated user can delete their own preferences.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Preference ID (returned by searchPreferences)',
        },
      },
      required: ['id'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = { resource: 'preferences', action: 'write' } as const;

  constructor(
    private readonly mutationTool: PreferenceMutationTool,
    private readonly preferenceService: PreferenceService,
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    try {
      const params = args as { id: string };
      const preference = await this.preferenceService.getPreference(
        params.id,
        context!.user.userId,
      );

      await this.authorizationService.assertAccessTarget(
        context!.client,
        this.requiredAccess,
        context!.grants,
        context!.user.userId,
        'tools/call',
        { slug: preference.slug },
      );

      const result = await this.mutationTool.delete(args as any, context!);
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
