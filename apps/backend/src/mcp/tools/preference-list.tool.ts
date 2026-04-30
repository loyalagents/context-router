import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PreferenceDefinitionRepository } from '@modules/preferences/preference-definition/preference-definition.repository';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';
import { McpToolExecutionResult } from '../access-log/access-log.types';
import {
  buildReadToolErrorResult,
  buildReadToolSuccessResult,
} from './base/read-tool-result.helper';

interface ListPreferencesParams {
  category?: string;
}

interface CatalogEntry {
  slug: string;
  category: string;
  description: string;
  valueType: string;
  options?: unknown;
  scope: string;
}

@Injectable()
export class PreferenceListTool implements McpToolInterface {
  private readonly logger = new Logger(PreferenceListTool.name);

  readonly descriptor: Tool = {
    name: 'listPreferenceSlugs',
    description:
      'List visible preference definitions from the catalog. Use this for schema discovery only, not stored user values. Returns slug, category, description, valueType, and scope for each visible preference definition.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Optional: filter by category (e.g., "food", "system", "dev")',
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
        categories: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        count: {
          type: 'integer',
        },
        preferences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              category: { type: 'string' },
              description: { type: 'string' },
              valueType: { type: 'string' },
              options: {},
              scope: { type: 'string' },
            },
          },
        },
      },
      additionalProperties: true,
    },
  };

  readonly requiresAuth = false;
  readonly requiredAccess = { resource: 'preferences', action: 'read' } as const;

  constructor(
    private defRepo: PreferenceDefinitionRepository,
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(args: unknown, context?: McpContext): Promise<McpToolExecutionResult> {
    const params = args as ListPreferencesParams;
    try {
      const result = await this.list(params, context);
      return {
        result: buildReadToolSuccessResult(
          this.descriptor.name,
          `${result.count} visible preference definitions across ${result.categories.length} categories`,
          result,
        ),
        accessLog: {
          requestMetadata: {
            category: params.category ?? null,
          },
          responseMetadata: {
            count: result.count,
            categories: result.categories,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: buildReadToolErrorResult(this.descriptor.name, message),
        accessLog: {
          requestMetadata: {
            category: params.category ?? null,
          },
          errorMetadata: {
            message,
          },
        },
      };
    }
  }

  async list(params: ListPreferencesParams, context?: McpContext) {
    const userId = context?.user?.userId;
    this.logger.log(
      `Listing preference catalog${params.category ? ` for category: ${params.category}` : ''}${userId ? ` for user: ${userId}` : ' (global only)'}`,
    );

    const allDefs = await this.defRepo.getAll(userId);

    const filtered = params.category
      ? allDefs.filter((d) => d.slug.split('.')[0] === params.category)
      : allDefs;

    const entries: CatalogEntry[] = filtered.map((def) => ({
      slug: def.slug,
      category: def.slug.split('.')[0],
      description: def.description,
      valueType: def.valueType,
      options: def.options,
      scope: def.scope,
    }));

    let visibleEntries = entries;
    if (context?.user && context?.client) {
      const allowedSlugs = new Set(
        await this.authorizationService.filterByTargetAccess(
          context.client,
          this.requiredAccess,
          context.grants,
          context.user.userId,
          entries.map((entry) => entry.slug),
        ),
      );
      visibleEntries = entries.filter((entry) => allowedSlugs.has(entry.slug));
    }

    const categories = Array.from(
      new Set(visibleEntries.map((entry) => entry.category)),
    ).sort();

    return {
      success: true as const,
      categories,
      count: visibleEntries.length,
      preferences: visibleEntries,
    };
  }
}
