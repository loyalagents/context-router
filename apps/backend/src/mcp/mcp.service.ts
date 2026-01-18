import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PreferenceSearchTool } from './tools/preference-search.tool';
import { PreferenceMutationTool } from './tools/preference-mutation.tool';
import { PreferenceListTool } from './tools/preference-list.tool';
import { SchemaResource } from './resources/schema.resource';
import { McpContext } from './types/mcp-context.type';

@Injectable()
export class McpService implements OnModuleInit {
  private readonly logger = new Logger(McpService.name);
  private server: Server;
  private currentContext: McpContext | null = null;

  constructor(
    private configService: ConfigService,
    private preferenceSearchTool: PreferenceSearchTool,
    private preferenceMutationTool: PreferenceMutationTool,
    private preferenceListTool: PreferenceListTool,
    private schemaResource: SchemaResource,
  ) {}

  async onModuleInit() {
    await this.initializeServer();
  }

  private async initializeServer() {
    const serverConfig = this.configService.get('mcp.server');

    this.server = new Server(
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
      `Initializing MCP Server: ${serverConfig.name} v${serverConfig.version}`,
    );

    // Register tools
    await this.registerTools();

    // Register resources
    await this.registerResources();

    this.logger.log('MCP Server initialized successfully');
  }

  private async registerTools() {
    const toolsEnabled = this.configService.get('mcp.tools.preferences.enabled');

    if (!toolsEnabled) {
      this.logger.warn('Preference tools are disabled in configuration');
      return;
    }

    this.logger.log('Registering MCP tools...');

    // Register tools list handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'listPreferenceSlugs',
            description:
              'List all valid preference slugs from the catalog. Use this to discover what preferences exist before suggesting new values. Returns slug, category, description, valueType, and scope for each preference.',
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
          },
          {
            name: 'searchPreferences',
            description:
              'Search user preferences by query, location, or retrieve all active preferences. Returns preferences scoped to the authenticated user.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description:
                    'Search by slug prefix, category, or description keyword',
                },
                locationId: {
                  type: 'string',
                  description:
                    'Include preferences for this location (merged with global)',
                },
                includeSuggestions: {
                  type: 'boolean',
                  description:
                    'If true, also return SUGGESTED preferences (inbox)',
                },
              },
            },
            annotations: {
              readOnlyHint: true,
              openWorldHint: false,
            },
          },
          {
            name: 'suggestPreference',
            description:
              'Suggest a preference value for the user. This creates a SUGGESTED preference that the user must approve in the UI. Use listPreferenceSlugs first to find valid slugs. If the user previously rejected this preference, the suggestion will be skipped.',
            inputSchema: {
              type: 'object',
              properties: {
                slug: {
                  type: 'string',
                  description:
                    'Preference slug from the catalog (e.g., "food.dietary_restrictions")',
                },
                value: {
                  type: 'string',
                  description:
                    'Preference value as JSON string. Examples: \'["peanuts", "shellfish"]\' for arrays, \'"casual"\' for enum strings',
                },
                confidence: {
                  type: 'number',
                  description:
                    'Confidence score between 0 and 1 (e.g., 0.85 for high confidence)',
                },
                locationId: {
                  type: 'string',
                  description:
                    'Optional location ID for location-scoped preferences',
                },
                evidence: {
                  type: 'string',
                  description:
                    'Optional JSON string with evidence metadata (messageIds, snippets, reason)',
                },
              },
              required: ['slug', 'value', 'confidence'],
            },
            annotations: {
              readOnlyHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
          {
            name: 'deletePreference',
            description:
              'Delete a preference. Only the authenticated user can delete their own preferences.',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Preference ID (returned by searchPreferences)',
                },
              },
              required: ['id'],
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
        ],
      };
    });

    // Register tool call handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      // Get context from the service (set by the controller for this request)
      const context = this.getContext();

      this.logger.log(
        `Tool called: ${name} by user: ${context?.user?.userId || 'unknown'}`,
      );

      // listPreferenceSlugs doesn't require auth
      if (name === 'listPreferenceSlugs') {
        try {
          const result = await this.preferenceListTool.list(args as any);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          this.logger.error(
            `Tool execution error: ${error.message}`,
            error.stack,
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: error.message }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      if (!context) {
        this.logger.error(`Tool called without context: ${name}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'Authentication context not available' },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        let result;

        switch (name) {
          case 'searchPreferences':
            result = await this.preferenceSearchTool.search(
              args as any,
              context,
            );
            break;
          case 'suggestPreference':
            result = await this.preferenceMutationTool.suggest(
              args as any,
              context,
            );
            break;
          case 'deletePreference':
            result = await this.preferenceMutationTool.delete(
              args as any,
              context,
            );
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        this.logger.error(`Tool execution error: ${error.message}`, error.stack);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });

    this.logger.log('Preference tools registered');
  }

  private async registerResources() {
    const resourcesEnabled = this.configService.get(
      'mcp.resources.schema.enabled',
    );

    if (!resourcesEnabled) {
      this.logger.warn('Schema resources are disabled in configuration');
      return;
    }

    this.logger.log('Registering MCP resources...');

    // Register resource list handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'schema://graphql',
            name: 'GraphQL Schema',
            description:
              'The GraphQL schema for the Context Router API, showing available types, queries, and mutations.',
            mimeType: 'text/plain',
          },
        ],
      };
    });

    // Register resource read handler
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      this.logger.log(`Resource requested: ${uri}`);

      if (uri === 'schema://graphql') {
        const schemaContent = await this.schemaResource.getGraphQLSchema();
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: schemaContent,
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });

    this.logger.log('Schema resources registered');
  }

  /**
   * Get the MCP server instance
   * Used by the controller to connect transports
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * Set the context for the current request
   * This context will be used by tool handlers to access the authenticated user
   */
  setContext(context: McpContext): void {
    this.currentContext = context;
  }

  /**
   * Get the context for the current request
   * Returns the context set by the controller for this request
   */
  getContext(): McpContext | null {
    return this.currentContext;
  }

  /**
   * Clear the context after request completion
   */
  clearContext(): void {
    this.currentContext = null;
  }
}
