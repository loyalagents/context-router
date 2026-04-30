import { Injectable } from '@nestjs/common';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PermissionGrantRepository } from '@modules/permission-grant/permission-grant.repository';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { McpToolExecutionResult } from '../access-log/access-log.types';
import {
  buildReadToolErrorResult,
  buildReadToolSuccessResult,
} from './base/read-tool-result.helper';

@Injectable()
export class PermissionGrantListTool implements McpToolInterface {
  // TODO: MCP tools for setting/removing grants are intentionally omitted for now.
  // A write-capable client should not be able to loosen its own restrictions until
  // we decide on a trust model, such as a separate permissions capability or an
  // explicit self-modification guard.
  readonly descriptor: Tool = {
    name: 'listPermissionGrants',
    description:
      'List permission grants for the calling MCP client only. Use this when expected preference or schema results may be hidden by MCP grant filtering.',
    inputSchema: {
      type: 'object',
      properties: {},
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
        grants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              clientKey: { type: 'string' },
              target: { type: 'string' },
              action: { type: 'string' },
              effect: { type: 'string' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
            },
          },
        },
      },
      additionalProperties: true,
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
      const structuredContent = {
        success: true as const,
        grants: grants.map((grant) => ({
          id: grant.id,
          clientKey: grant.clientKey,
          target: grant.target,
          action: grant.action,
          effect: grant.effect,
          createdAt: grant.createdAt,
          updatedAt: grant.updatedAt,
        })),
      };

      return {
        result: buildReadToolSuccessResult(
          this.descriptor.name,
          `${grants.length} grants for client ${context!.client.key}`,
          structuredContent,
        ),
        accessLog: {
          responseMetadata: {
            grantCount: grants.length,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: buildReadToolErrorResult(this.descriptor.name, message),
        accessLog: {
          errorMetadata: {
            message,
          },
        },
      };
    }
  }
}
