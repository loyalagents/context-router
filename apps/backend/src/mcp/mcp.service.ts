import { Injectable, Logger } from '@nestjs/common';
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
import { PreferenceDefinitionTool } from './tools/preference-definition.tool';
import { SchemaResource } from './resources/schema.resource';
import { McpContext } from './types/mcp-context.type';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private configService: ConfigService,
    private preferenceSearchTool: PreferenceSearchTool,
    private preferenceMutationTool: PreferenceMutationTool,
    private preferenceListTool: PreferenceListTool,
    private preferenceDefinitionTool: PreferenceDefinitionTool,
    private schemaResource: SchemaResource,
  ) {}

  createServer(context: McpContext): Server {
    const serverConfig = this.configService.get('mcp.server');
    const toolsEnabled = this.configService.get('mcp.tools.preferences.enabled');
    const resourcesEnabled = this.configService.get('mcp.resources.schema.enabled');

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

    if (toolsEnabled) {
      server.setRequestHandler(ListToolsRequestSchema, async () => {
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
            {
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
                    description: 'Human-readable description of what this preference represents.',
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
            },
          ],
        };
      });

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        this.logger.log(
          `Tool called: ${name} by user: ${context?.user?.userId || 'unknown'}`,
        );

        // listPreferenceSlugs doesn't require auth
        if (name === 'listPreferenceSlugs') {
          try {
            const result = await this.preferenceListTool.list(args as any, context);
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
            case 'createPreferenceDefinition':
              result = await this.preferenceDefinitionTool.create(
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
      });
    } else {
      this.logger.warn('Preference tools are disabled in configuration');
    }

    if (resourcesEnabled) {
      server.setRequestHandler(ListResourcesRequestSchema, async () => {
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

      server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request) => {
          const { uri } = request.params;

          this.logger.log(`Resource requested: ${uri}`);

          if (uri === 'schema://graphql') {
            const schemaContent =
              await this.schemaResource.getGraphQLSchema();
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
    } else {
      this.logger.warn('Schema resources are disabled in configuration');
    }

    return server;
  }
}
