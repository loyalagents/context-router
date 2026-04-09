import { Injectable, Logger } from "@nestjs/common";
import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PreferenceDefinitionRepository } from "@modules/preferences/preference-definition/preference-definition.repository";
import { McpContext } from "../types/mcp-context.type";
import { McpToolInterface } from "./base/mcp-tool.interface";

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
    name: "listPreferenceSlugs",
    description:
      "List all valid preference slugs from the catalog. Use this to discover what preferences exist before suggesting new values. Returns slug, category, description, valueType, and scope for each preference.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            'Optional: filter by category (e.g., "food", "system", "dev")',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  };

  readonly requiresAuth = false;
  readonly requiredAccess = { resource: 'preferences', action: 'read' } as const;

  constructor(private defRepo: PreferenceDefinitionRepository) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    try {
      const result = await this.list(args as ListPreferencesParams, context);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  async list(params: ListPreferencesParams, context?: McpContext) {
    const userId = context?.user?.userId;
    const schemaNamespace = context?.user?.schemaNamespace;
    this.logger.log(
      `Listing preference catalog${params.category ? ` for category: ${params.category}` : ""}${userId ? ` for user: ${userId}` : " (global only)"}`,
    );

    try {
      const allDefs = await this.defRepo.getAll(userId, schemaNamespace);

      const filtered = params.category
        ? allDefs.filter((d) => d.slug.split(".")[0] === params.category)
        : allDefs;

      const entries: CatalogEntry[] = filtered.map((def) => ({
        slug: def.slug,
        category: def.slug.split(".")[0],
        description: def.description,
        valueType: def.valueType,
        options: def.options,
        scope: def.scope,
      }));

      const categories = await this.defRepo.getAllCategories(
        userId,
        schemaNamespace,
      );

      return {
        success: true,
        categories,
        count: entries.length,
        preferences: entries,
      };
    } catch (error) {
      this.logger.error(`Error listing preference catalog: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
