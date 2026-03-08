import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SchemaResource } from "./resources/schema.resource";
import { PreferenceListTool } from "./tools/preference-list.tool";
import { PreferenceMutationTool } from "./tools/preference-mutation.tool";
import { PreferenceSearchTool } from "./tools/preference-search.tool";
import { McpContext } from "./types/mcp-context.type";

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private configService: ConfigService,
    private preferenceSearchTool: PreferenceSearchTool,
    private preferenceMutationTool: PreferenceMutationTool,
    private preferenceListTool: PreferenceListTool,
    private schemaResource: SchemaResource,
  ) {}

  createServer(context: McpContext | null = null): Server {
    const serverConfig = this.configService.get<{
      name: string;
      version: string;
    }>("mcp.server");

    if (!serverConfig) {
      throw new Error("MCP server configuration is missing");
    }

    const server = new Server(
      {
        name: serverConfig.name,
        version: serverConfig.version,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    this.logger.log(
      `Creating MCP server: ${serverConfig.name} v${serverConfig.version}`,
    );

    this.registerTools(server, context);
    this.registerResources(server);

    return server;
  }

  private createTextResult(payload: unknown, isError = false) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
      ...(isError && { isError: true }),
    };
  }

  private createToolError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return this.createTextResult({ error: message }, true);
  }

  private registerTools(server: Server, context: McpContext | null) {
    const toolsEnabled = this.configService.get(
      "mcp.tools.preferences.enabled",
    );

    if (!toolsEnabled) {
      this.logger.warn("Preference tools are disabled in configuration");
      return;
    }

    this.logger.log("Registering MCP tools...");

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "listPreferenceSlugs",
          description:
            "List all valid preference slugs visible to the authenticated user, including user-owned definitions. Use this to discover what preferences exist before suggesting new values. Returns slug, category, description, valueType, and scope for each preference.",
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
        },
        {
          name: "searchPreferences",
          description:
            "Search user preferences by query, category, location, or retrieve all active preferences. Returns preferences scoped to the authenticated user.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search by slug prefix, category, or description keyword",
              },
              category: {
                type: "string",
                description:
                  "Deprecated alias for query. Filters by preference category.",
              },
              locationId: {
                type: "string",
                description:
                  "Include preferences for this location (merged with global)",
              },
              includeSuggestions: {
                type: "boolean",
                description:
                  "If true, also return SUGGESTED preferences (inbox)",
              },
            },
          },
          annotations: {
            readOnlyHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "suggestPreference",
          description:
            "Suggest a preference value for the user. This creates a SUGGESTED preference that the user must approve in the UI. Use listPreferenceSlugs first to find valid slugs. If the user previously rejected this preference, the suggestion will be skipped.",
          inputSchema: {
            type: "object",
            properties: {
              slug: {
                type: "string",
                description:
                  'Preference slug from the catalog (e.g., "food.dietary_restrictions")',
              },
              value: {
                type: "string",
                description:
                  'Preference value as JSON string. Examples: \'["peanuts", "shellfish"]\' for arrays, \'"casual"\' for enum strings',
              },
              confidence: {
                type: "number",
                description:
                  "Confidence score between 0 and 1 (e.g., 0.85 for high confidence)",
              },
              locationId: {
                type: "string",
                description:
                  "Optional location ID for location-scoped preferences",
              },
              evidence: {
                type: "string",
                description:
                  "Optional JSON string with evidence metadata (messageIds, snippets, reason)",
              },
            },
            required: ["slug", "value", "confidence"],
          },
          annotations: {
            readOnlyHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "deletePreference",
          description:
            "Delete a preference. Only the authenticated user can delete their own preferences.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Preference ID (returned by searchPreferences)",
              },
            },
            required: ["id"],
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      this.logger.log(
        `Tool called: ${name} by user: ${context?.user?.userId || "unknown"}`,
      );

      if (name === "listPreferenceSlugs") {
        try {
          const result = await this.preferenceListTool.list(
            (args as Record<string, unknown> | undefined) ?? {},
            context?.user.userId,
          );
          return this.createTextResult(result);
        } catch (error) {
          this.logger.error(
            `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
          return this.createToolError(error);
        }
      }

      if (!context) {
        this.logger.error(`Tool called without context: ${name}`);
        return this.createTextResult(
          { error: "Authentication context not available" },
          true,
        );
      }

      try {
        let result;

        switch (name) {
          case "searchPreferences":
            result = await this.preferenceSearchTool.search(
              (args as Record<string, unknown> | undefined) ?? {},
              context,
            );
            break;
          case "suggestPreference":
            result = await this.preferenceMutationTool.suggest(
              args as any,
              context,
            );
            break;
          case "deletePreference":
            result = await this.preferenceMutationTool.delete(
              args as any,
              context,
            );
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return this.createTextResult(result);
      } catch (error) {
        this.logger.error(
          `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        return this.createToolError(error);
      }
    });

    this.logger.log("Preference tools registered");
  }

  private registerResources(server: Server) {
    const resourcesEnabled = this.configService.get(
      "mcp.resources.schema.enabled",
    );

    if (!resourcesEnabled) {
      this.logger.warn("Schema resources are disabled in configuration");
      return;
    }

    this.logger.log("Registering MCP resources...");

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "schema://graphql",
          name: "GraphQL Schema",
          description:
            "The GraphQL schema for the Context Router API, showing available types, queries, and mutations.",
          mimeType: "text/plain",
        },
      ],
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      this.logger.log(`Resource requested: ${uri}`);

      if (uri === "schema://graphql") {
        const schemaContent = await this.schemaResource.getGraphQLSchema();
        return {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: schemaContent,
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });

    this.logger.log("Schema resources registered");
  }
}
