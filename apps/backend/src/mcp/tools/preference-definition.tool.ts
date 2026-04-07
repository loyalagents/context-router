import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@infrastructure/prisma/generated-client';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PreferenceDefinitionService } from '@modules/preferences/preference-definition/preference-definition.service';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';

const VALID_VALUE_TYPES = ['STRING', 'BOOLEAN', 'ENUM', 'ARRAY'] as const;
const VALID_SCOPES = ['GLOBAL', 'LOCATION'] as const;

interface CreatePreferenceDefinitionParams {
  slug: string;
  description: string;
  valueType: 'STRING' | 'BOOLEAN' | 'ENUM' | 'ARRAY';
  scope: 'GLOBAL' | 'LOCATION';
  displayName?: string;
  options?: unknown;
  isSensitive?: boolean;
}

@Injectable()
export class PreferenceDefinitionTool implements McpToolInterface {
  private readonly logger = new Logger(PreferenceDefinitionTool.name);

  readonly descriptor: Tool = {
    name: 'createPreferenceDefinition',
    description:
      'Create a new personal preference definition (schema) for a slug that does not yet exist. Call this when suggestPreference fails with UNKNOWN_PREFERENCE_SLUG, then retry suggestPreference with the new slug. Definitions are user-owned and immediately usable.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description:
            'Preference slug (e.g., "cooking.preferred_oil"). Must be lowercase with dots.',
        },
        description: {
          type: 'string',
          description:
            'Human-readable description of what this preference represents.',
        },
        valueType: {
          type: 'string',
          enum: ['STRING', 'BOOLEAN', 'ENUM', 'ARRAY'],
          description: 'Data type of the preference value.',
        },
        scope: {
          type: 'string',
          enum: ['GLOBAL', 'LOCATION'],
          description:
            'GLOBAL for preferences that apply everywhere; LOCATION for location-scoped preferences.',
        },
        displayName: {
          type: 'string',
          description: 'Optional short human-readable label.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Required when valueType is ENUM. List of valid option strings. Must not be provided for other value types.',
        },
        isSensitive: {
          type: 'boolean',
          description:
            'Set to true if the preference contains sensitive personal data. Defaults to false.',
        },
      },
      required: ['slug', 'description', 'valueType', 'scope'],
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = { resource: 'preferences', action: 'write' } as const;

  constructor(private defService: PreferenceDefinitionService) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    try {
      const result = await this.create(
        args as CreatePreferenceDefinitionParams,
        context!,
      );
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

  async create(
    params: CreatePreferenceDefinitionParams,
    context: McpContext,
  ) {
    const userId = context.user.userId;

    this.logger.log(
      `Creating preference definition: ${params.slug} for user ${userId}`,
    );

    if (!VALID_VALUE_TYPES.includes(params.valueType as any)) {
      return {
        success: false,
        code: 'INVALID_PREFERENCE_DEFINITION',
        error: `Invalid valueType: "${params.valueType}". Must be one of: ${VALID_VALUE_TYPES.join(', ')}`,
      };
    }
    if (!VALID_SCOPES.includes(params.scope as any)) {
      return {
        success: false,
        code: 'INVALID_PREFERENCE_DEFINITION',
        error: `Invalid scope: "${params.scope}". Must be one of: ${VALID_SCOPES.join(', ')}`,
      };
    }

    if (params.valueType === 'ENUM') {
      if (
        !params.options ||
        !Array.isArray(params.options) ||
        params.options.length === 0 ||
        !params.options.every((o) => typeof o === 'string')
      ) {
        return {
          success: false,
          code: 'INVALID_PREFERENCE_DEFINITION',
          error:
            'valueType ENUM requires options to be a non-empty array of strings',
        };
      }
    } else if (params.options !== undefined) {
      return {
        success: false,
        code: 'INVALID_PREFERENCE_DEFINITION',
        error: `options is only valid for valueType ENUM, not ${params.valueType}`,
      };
    }

    try {
      const created = await this.defService.create(
        {
          slug: params.slug,
          description: params.description,
          valueType: params.valueType as any,
          scope: params.scope as any,
          displayName: params.displayName,
          options: params.options,
          isSensitive: params.isSensitive ?? false,
          isCore: false,
        },
        userId,
        context.user.schemaNamespace,
      );

      this.logger.log(`Preference definition created: ${created.id}`);

      return {
        success: true,
        definition: {
          id: created.id,
          slug: created.slug,
          category: created.slug.split('.')[0],
          displayName: created.displayName ?? null,
          description: created.description,
          valueType: created.valueType,
          scope: created.scope,
          options: created.options ?? null,
          isSensitive: created.isSensitive,
          visibility: 'USER',
        },
      };
    } catch (error) {
      this.logger.error(
        `Error creating preference definition for user ${userId}: ${error.message}`,
        error.stack,
      );

      if (error instanceof ConflictException) {
        return {
          success: false,
          code: 'PREFERENCE_DEFINITION_CONFLICT',
          error: error.message,
        };
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          success: false,
          code: 'PREFERENCE_DEFINITION_CONFLICT',
          error: `A preference definition with slug "${params.slug}" already exists`,
        };
      }

      if (error instanceof BadRequestException) {
        return {
          success: false,
          code: 'INVALID_PREFERENCE_DEFINITION',
          error: error.message,
        };
      }

      return {
        success: false,
        code: 'INTERNAL_ERROR',
        error: error.message,
      };
    }
  }
}
