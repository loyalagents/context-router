import { Injectable } from '@nestjs/common';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PermissionGrantRepository } from '@modules/permission-grant/permission-grant.repository';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { McpToolExecutionResult } from '../access-log/access-log.types';

@Injectable()
export class PermissionGrantListTool implements McpToolInterface {
  // TODO: MCP tools for setting/removing grants are intentionally omitted for now.
  // A write-capable client should not be able to loosen its own restrictions until
  // we decide on a trust model, such as a separate permissions capability or an
  // explicit self-modification guard.
  readonly descriptor: Tool = {
    name: 'listPermissionGrants',
    description:
      'List permission grants for the calling MCP client only. Read-only introspection for debugging access.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = { resource: 'preferences', action: 'read' } as const;

  constructor(private readonly repository: PermissionGrantRepository) {}

  async execute(_: unknown, context?: McpContext): Promise<McpToolExecutionResult> {
    try {
      const grants = await this.repository.findByUserAndClient(
        context!.user.userId,
        context!.client.key,
      );

      return {
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  grants: grants.map((grant) => ({
                    id: grant.id,
                    clientKey: grant.clientKey,
                    target: grant.target,
                    action: grant.action,
                    effect: grant.effect,
                    createdAt: grant.createdAt,
                    updatedAt: grant.updatedAt,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        },
        accessLog: {
          responseMetadata: {
            grantCount: grants.length,
          },
        },
      };
    } catch (error) {
      return {
        result: {
          content: [
            { type: 'text', text: JSON.stringify({ error: error.message }, null, 2) },
          ],
          isError: true,
        },
        accessLog: {
          errorMetadata: {
            message: error.message,
          },
        },
      };
    }
  }
}
