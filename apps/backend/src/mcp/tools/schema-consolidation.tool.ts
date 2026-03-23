import { Injectable, Logger } from '@nestjs/common';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { SchemaConsolidationWorkflow } from '@modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow';

@Injectable()
export class SchemaConsolidationTool implements McpToolInterface {
  private readonly logger = new Logger(SchemaConsolidationTool.name);

  readonly descriptor: Tool = {
    name: 'consolidateSchema',
    description:
      'Identifies duplicate or overlapping personal preference definitions. Advisory only — no changes made.',
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
    },
  };

  readonly requiresAuth = true;

  constructor(private readonly workflow: SchemaConsolidationWorkflow) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    const params = (args ?? {}) as { scope?: 'PERSONAL' | 'ALL' };

    try {
      const result = await this.workflow.run({
        userId: context!.user.userId,
        scope: params.scope ?? 'PERSONAL',
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      this.logger.error(
        `Schema consolidation failed for user ${context?.user?.userId}: ${error.message}`,
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
