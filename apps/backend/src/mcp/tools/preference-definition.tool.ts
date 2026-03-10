import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@infrastructure/prisma/generated-client';
import { PreferenceDefinitionService } from '@modules/preferences/preference-definition/preference-definition.service';
import { McpContext } from '../types/mcp-context.type';

const VALID_VALUE_TYPES = ['STRING', 'BOOLEAN', 'ENUM', 'ARRAY'] as const;
const VALID_SCOPES = ['GLOBAL', 'LOCATION'] as const;

interface CreatePreferenceDefinitionParams {
  slug: string;
  description: string;
  valueType: 'STRING' | 'BOOLEAN' | 'ENUM' | 'ARRAY';
  scope: 'GLOBAL' | 'LOCATION';
  displayName?: string;
  options?: unknown; // native JSON array — required for ENUM, forbidden for others
  isSensitive?: boolean;
}

@Injectable()
export class PreferenceDefinitionTool {
  private readonly logger = new Logger(PreferenceDefinitionTool.name);

  constructor(private defService: PreferenceDefinitionService) {}

  async create(params: CreatePreferenceDefinitionParams, context: McpContext) {
    const userId = context.user.userId;

    this.logger.log(`Creating preference definition: ${params.slug} for user ${userId}`);

    // MCP-boundary enum validation
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

    // MCP-boundary validation for options
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
          error: 'valueType ENUM requires options to be a non-empty array of strings',
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
