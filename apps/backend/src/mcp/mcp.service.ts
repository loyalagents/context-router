import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from './types/mcp-context.type';
import { MCP_RESOURCES, MCP_TOOLS } from './mcp.constants';
import { McpToolInterface } from './tools/base/mcp-tool.interface';
import { McpResourceInterface } from './resources/base/mcp-resource.interface';
import {
  McpAuthorizationError,
  McpAuthorizationService,
} from './auth/mcp-authorization.service';

@Injectable()
export class McpService implements OnModuleInit {
  private readonly logger = new Logger(McpService.name);
  private readonly toolMap = new Map<string, McpToolInterface>();
  private readonly resourceMap = new Map<string, McpResourceInterface>();

  constructor(
    private configService: ConfigService,
    @Inject(MCP_TOOLS) private readonly tools: McpToolInterface[],
    @Inject(MCP_RESOURCES) private readonly resources: McpResourceInterface[],
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  onModuleInit() {
    for (const tool of this.tools) {
      const name = tool.descriptor.name;
      if (this.toolMap.has(name)) {
        throw new Error(`Duplicate MCP tool name: "${name}"`);
      }
      if (!tool.requiredAccess) {
        throw new Error(`MCP tool "${name}" is missing requiredAccess`);
      }
      this.authorizationService.toCapability(tool.requiredAccess);
      this.toolMap.set(name, tool);
    }

    for (const resource of this.resources) {
      const uri = resource.descriptor.uri;
      if (this.resourceMap.has(uri)) {
        throw new Error(`Duplicate MCP resource URI: "${uri}"`);
      }
      if (!resource.requiredAccess) {
        throw new Error(`MCP resource "${uri}" is missing requiredAccess`);
      }
      this.authorizationService.toCapability(resource.requiredAccess);
      this.resourceMap.set(uri, resource);
    }

    this.logger.log(
      `Registered ${this.toolMap.size} MCP tools: ${[...this.toolMap.keys()].join(', ')}`,
    );
    this.logger.log(
      `Registered ${this.resourceMap.size} MCP resources: ${[...this.resourceMap.keys()].join(', ')}`,
    );
  }

  createServer(context: McpContext): Server {
    const serverConfig = this.configService.get<{
      name: string;
      version: string;
    }>('mcp.server');

    if (!serverConfig) {
      throw new Error('MCP server configuration is missing');
    }

    const toolsEnabled = this.configService.get('mcp.tools.preferences.enabled');
    const resourcesEnabled = this.configService.get(
      'mcp.resources.schema.enabled',
    );

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
          tools: [...this.toolMap.values()]
            .filter((tool) =>
              this.authorizationService.canAccess(
                context.client,
                tool.requiredAccess,
                context.grants,
              ),
            )
            .map((tool) => tool.descriptor),
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
                type: "text",
                text: JSON.stringify(
                  { error: `Unknown tool: ${name}` },
                  null,
                  2,
                ),
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
                type: "text",
                text: JSON.stringify(
                  { error: "Authentication context not available" },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        try {
          this.authorizationService.assertAccess(
            context.client,
            tool.requiredAccess,
            context.grants,
            'tools/call',
          );
        } catch (error) {
          if (error instanceof McpAuthorizationError) {
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
          throw error;
        }

        return tool.execute(args, context);
      });
    } else {
      this.logger.warn('Preference tools are disabled in configuration');
    }

    if (resourcesEnabled) {
      server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return {
          resources: [...this.resourceMap.values()]
            .filter((resource) =>
              this.authorizationService.canAccess(
                context.client,
                resource.requiredAccess,
                context.grants,
              ),
            )
            .map((resource) => resource.descriptor),
        };
      });

      server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request) => {
          const { uri } = request.params;

          this.logger.log(`Resource requested: ${uri}`);

          const resource = this.resourceMap.get(uri);
          if (!resource) {
            throw new Error(`Unknown resource: ${uri}`);
          }

          this.authorizationService.assertAccess(
            context.client,
            resource.requiredAccess,
            context.grants,
            'resources/read',
          );

          return resource.read(context);
        },
      );
    } else {
      this.logger.warn('Schema resources are disabled in configuration');
    }

    return server;
  }
}
