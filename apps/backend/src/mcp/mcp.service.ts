import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SchemaResource } from './resources/schema.resource';
import { McpContext } from './types/mcp-context.type';
import { MCP_TOOLS } from './mcp.constants';
import { McpToolInterface } from './tools/base/mcp-tool.interface';

@Injectable()
export class McpService implements OnModuleInit {
  private readonly logger = new Logger(McpService.name);
  private readonly toolMap = new Map<string, McpToolInterface>();

  constructor(
    private configService: ConfigService,
    @Inject(MCP_TOOLS) private readonly tools: McpToolInterface[],
    private schemaResource: SchemaResource,
  ) {}

  onModuleInit() {
    for (const tool of this.tools) {
      const name = tool.descriptor.name;
      if (this.toolMap.has(name)) {
        throw new Error(`Duplicate MCP tool name: "${name}"`);
      }
      this.toolMap.set(name, tool);
    }
    this.logger.log(
      `Registered ${this.toolMap.size} MCP tools: ${[...this.toolMap.keys()].join(', ')}`,
    );
  }

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
          tools: [...this.toolMap.values()].map((t) => t.descriptor),
        };
      });

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        this.logger.log(
          `Tool called: ${name} by user: ${context?.user?.userId || 'unknown'}`,
        );

        const tool = this.toolMap.get(name);
        if (!tool) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2),
              },
            ],
            isError: true,
          };
        }

        if (tool.requiresAuth && !context) {
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

        return tool.execute(args, context);
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
