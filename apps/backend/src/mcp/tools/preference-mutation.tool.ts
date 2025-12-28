import { Injectable, Logger } from '@nestjs/common';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { McpContext } from '../types/mcp-context.type';

interface CreatePreferenceParams {
  category: string;
  key: string;
  value: string; // JSON string that will be parsed
  locationId?: string;
}

interface UpdatePreferenceParams {
  preferenceId: string;
  value: string; // JSON string that will be parsed
}

/**
 * Parse a JSON string value from MCP tool input.
 * Returns the parsed value or throws a descriptive error.
 */
function parseJsonValue(value: string, context: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(
      `Invalid JSON in ${context}: "${value}". ` +
        `Expected a valid JSON string like '["item1", "item2"]' for arrays, ` +
        `'{"key": "value"}' for objects, or '"text"' for strings.`,
    );
  }
}

interface DeletePreferenceParams {
  preferenceId: string;
}

@Injectable()
export class PreferenceMutationTool {
  private readonly logger = new Logger(PreferenceMutationTool.name);

  constructor(private preferenceService: PreferenceService) {}

  async create(params: CreatePreferenceParams, context: McpContext) {
    // TODO: MCP_USER_CONTEXT - Extract userId from JWT context
    // Users can only create preferences for themselves
    const userId = context.user.userId;

    this.logger.log(
      `Creating preference for user ${userId}: ${params.category}/${params.key}`,
    );

    try {
      // Parse the JSON string value from MCP input
      const parsedValue = parseJsonValue(params.value, 'value');

      const preference = await this.preferenceService.create(userId, {
        category: params.category,
        key: params.key,
        value: parsedValue,
        locationId: params.locationId,
      });

      this.logger.log(
        `Preference created successfully: ${preference.preferenceId}`,
      );

      return {
        success: true,
        preference,
      };
    } catch (error) {
      this.logger.error(
        `Error creating preference for user ${userId}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async update(params: UpdatePreferenceParams, context: McpContext) {
    // TODO: MCP_USER_CONTEXT - Extract userId from JWT context
    // PreferenceService.update() will verify ownership
    const userId = context.user.userId;

    this.logger.log(
      `Updating preference ${params.preferenceId} for user ${userId}`,
    );

    try {
      // Parse the JSON string value from MCP input
      const parsedValue = parseJsonValue(params.value, 'value');

      const preference = await this.preferenceService.update(
        params.preferenceId,
        userId,
        {
          value: parsedValue,
        },
      );

      this.logger.log(
        `Preference updated successfully: ${preference.preferenceId}`,
      );

      return {
        success: true,
        preference,
      };
    } catch (error) {
      this.logger.error(
        `Error updating preference ${params.preferenceId} for user ${userId}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async delete(params: DeletePreferenceParams, context: McpContext) {
    // TODO: MCP_USER_CONTEXT - Extract userId from JWT context
    // PreferenceService.delete() will verify ownership
    const userId = context.user.userId;

    this.logger.log(
      `Deleting preference ${params.preferenceId} for user ${userId}`,
    );

    try {
      const preference = await this.preferenceService.delete(
        params.preferenceId,
        userId,
      );

      this.logger.log(
        `Preference deleted successfully: ${preference.preferenceId}`,
      );

      return {
        success: true,
        preference,
      };
    } catch (error) {
      this.logger.error(
        `Error deleting preference ${params.preferenceId} for user ${userId}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }
}
