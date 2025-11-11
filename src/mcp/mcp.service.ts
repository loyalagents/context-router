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
import { SchemaResource } from './resources/schema.resource';
import { McpContext } from './types/mcp-context.type';

@Injectable()
export class McpService implements OnModuleInit {
  private readonly logger = new Logger(McpService.name);
  private server: Server;

  constructor(
    private configService: ConfigService,
    private preferenceSearchTool: PreferenceSearchTool,
    private preferenceMutationTool: PreferenceMutationTool,
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
              name: 'searchPreferences',
              description:
                'Search user preferences by category, location, or retrieve all preferences. Returns preferences scoped to the authenticated user.',
              inputSchema: {
                type: 'object',
                properties: {
                  category: {
                    type: 'string',
                    description:
                      'Filter preferences by category (e.g., "appearance", "notifications")',
                  },
                  locationId: {
                    type: 'string',
                    description:
                      'Filter preferences by location ID (returns location-specific preferences)',
                  },
                  globalOnly: {
                    type: 'boolean',
                    description:
                      'If true, only return global preferences (not tied to a location)',
                  },
                },
              },
            },
            {
              name: 'createPreference',
              description:
                'Create a new preference for the authenticated user. Preferences can be global or location-specific.',
              inputSchema: {
                type: 'object',
                properties: {
                  category: {
                    type: 'string',
                    description: 'Preference category',
                  },
                  key: {
                    type: 'string',
                    description: 'Preference key/name',
                  },
                  value: {
                    type: 'object',
                    description:
                      'Preference value (JSON object). Can be any valid JSON structure.',
                  },
                  locationId: {
                    type: 'string',
                    description:
                      'Optional location ID to create location-specific preference',
                  },
                },
                required: ['category', 'key', 'value'],
              },
            },
            {
              name: 'updatePreference',
              description:
                'Update an existing preference value. Only the authenticated user can update their own preferences.',
              inputSchema: {
                type: 'object',
                properties: {
                  preferenceId: {
                    type: 'string',
                    description: 'ID of the preference to update',
                  },
                  value: {
                    type: 'object',
                    description: 'New preference value (JSON object)',
                  },
                },
                required: ['preferenceId', 'value'],
              },
            },
            {
              name: 'deletePreference',
              description:
                'Delete a preference. Only the authenticated user can delete their own preferences.',
              inputSchema: {
                type: 'object',
                properties: {
                  preferenceId: {
                    type: 'string',
                    description: 'ID of the preference to delete',
                  },
                },
                required: ['preferenceId'],
              },
            },
          ],
      };
    });

    // Register tool call handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
        const context = (request as any).context as McpContext;

        this.logger.log(`Tool called: ${name} by user: ${context?.user?.userId || 'unknown'}`);

        try {
          let result;

          switch (name) {
            case 'searchPreferences':
              result = await this.preferenceSearchTool.search(args as any, context);
              break;
            case 'createPreference':
              result = await this.preferenceMutationTool.create(args as any, context);
              break;
            case 'updatePreference':
              result = await this.preferenceMutationTool.update(args as any, context);
              break;
            case 'deletePreference':
              result = await this.preferenceMutationTool.delete(args as any, context);
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
      },
    );

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
      },
    );

    this.logger.log('Schema resources registered');
  }

  /**
   * Get the MCP server instance
   * Used by the controller to connect transports
   */
  getServer(): Server {
    return this.server;
  }
}
