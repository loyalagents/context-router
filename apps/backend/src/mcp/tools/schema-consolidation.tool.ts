import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { SchemaConsolidationWorkflow } from '@modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';
import { McpToolExecutionResult } from '../access-log/access-log.types';
import {
  buildReadToolErrorResult,
  buildReadToolSuccessResult,
} from './base/read-tool-result.helper';

@Injectable()
export class SchemaConsolidationTool implements McpToolInterface {
  private readonly logger = new Logger(SchemaConsolidationTool.name);

  readonly descriptor: Tool = {
    name: 'consolidateSchema',
    description:
      'Analyze visible preference definitions for duplicate or overlapping schema entries. Advisory schema analysis only; it does not retrieve stored preference values or make changes.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['PERSONAL', 'ALL'],
          description:
            'PERSONAL to analyze only your definitions, ALL to include global definitions too. Defaults to PERSONAL.',
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
        totalDefinitionsAnalyzed: {
          type: 'integer',
        },
        consolidationGroups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slugs: {
                type: 'array',
                items: { type: 'string' },
              },
              reason: { type: 'string' },
              suggestion: { type: 'string' },
              recommendedSlug: { type: 'string' },
              slugScopes: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
            },
          },
        },
        summary: {
          type: 'string',
        },
      },
      additionalProperties: true,
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = { resource: 'preferences', action: 'read' } as const;

  constructor(
    private readonly workflow: SchemaConsolidationWorkflow,
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<McpToolExecutionResult> {
    const params = (args ?? {}) as { scope?: 'PERSONAL' | 'ALL' };

    try {
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
        scope: params.scope ?? 'PERSONAL',
      });
      const structuredContent = {
        success: true as const,
        ...result,
      };

      return {
        result: buildReadToolSuccessResult(
          this.descriptor.name,
          `${result.consolidationGroups.length} consolidation groups from ${result.totalDefinitionsAnalyzed} definitions`,
          structuredContent,
        ),
        accessLog: {
          requestMetadata: {
            scope: params.scope ?? 'PERSONAL',
          },
          responseMetadata: {
            totalDefinitionsAnalyzed: result.totalDefinitionsAnalyzed,
            consolidationGroupCount: result.consolidationGroups.length,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Schema consolidation failed for user ${context?.user?.userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        result: buildReadToolErrorResult(this.descriptor.name, message),
        accessLog: {
          requestMetadata: {
            scope: params.scope ?? 'PERSONAL',
          },
          errorMetadata: {
            message,
          },
        },
      };
    }
  }
}
