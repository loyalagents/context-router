import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
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
import { McpAccessLogService } from './access-log/mcp-access-log.service';
import { McpAccessLogMetadata } from './access-log/access-log.types';
import {
  McpAccessOutcome,
  McpAccessSurface,
} from '@infrastructure/prisma/generated-client';

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
    private readonly mcpAccessLogService: McpAccessLogService,
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
      for (const access of this.authorizationService.normalizeAccessList(
        tool.requiredAccess,
      )) {
        this.authorizationService.toCapability(access);
      }
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
    const serverConfig = this.configService.get('mcp.server');
    const toolsEnabled = this.configService.get(
      'mcp.tools.preferences.enabled',
    );
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
              this.authorizationService.canAccessAny(
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
        const startedAt = performance.now();
        const dispatchContext: McpContext = {
          ...context,
          correlationId: randomUUID(),
        };

        this.logger.log(
          `Tool called: ${name} by user: ${dispatchContext?.user?.userId || 'unknown'}`,
        );

        const tool = this.toolMap.get(name);
        if (!tool) {
          const result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { error: `Unknown tool: ${name}` },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
          await this.recordMcpAccessEvent({
            context: dispatchContext,
            surface: McpAccessSurface.TOOLS_CALL,
            operationName: name,
            outcome: McpAccessOutcome.ERROR,
            latencyMs: this.elapsedMs(startedAt),
            accessLog: {
              errorMetadata: {
                source: 'DISPATCH',
                message: `Unknown tool: ${name}`,
              },
            },
          });
          return result;
        }

        const shouldLogAccess =
          tool.accessLogPolicy === 'always' ||
          tool.descriptor.annotations?.readOnlyHint === true;

        if (tool.requiresAuth && !dispatchContext) {
          this.logger.error(`Tool called without context: ${name}`);
          const result = {
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
          if (shouldLogAccess) {
            await this.recordMcpAccessEvent({
              context: dispatchContext,
              surface: McpAccessSurface.TOOLS_CALL,
              operationName: name,
              outcome: McpAccessOutcome.ERROR,
              latencyMs: this.elapsedMs(startedAt),
              accessLog: {
                errorMetadata: {
                  source: 'DISPATCH',
                  message: 'Authentication context not available',
                },
              },
            });
          }
          return result;
        }

        try {
          if (
            !this.authorizationService.canAccessAny(
              dispatchContext.client,
              tool.requiredAccess,
              dispatchContext.grants,
            )
          ) {
            const capabilities = this.authorizationService
              .normalizeAccessList(tool.requiredAccess)
              .map((access) => this.authorizationService.toCapability(access));
            const message = `Client "${dispatchContext.client.key}" is not allowed to call tool "${name}"`;
            this.logger.warn(
              JSON.stringify({
                decision: 'deny',
                clientKey: dispatchContext.client.key,
                surface: 'tools/call',
                toolName: name,
                capabilities,
              }),
            );

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: message }, null, 2),
                },
              ],
              isError: true,
            };
            if (shouldLogAccess) {
              await this.recordMcpAccessEvent({
                context: dispatchContext,
                surface: McpAccessSurface.TOOLS_CALL,
                operationName: name,
                outcome: McpAccessOutcome.DENY,
                latencyMs: this.elapsedMs(startedAt),
                accessLog: {
                  errorMetadata: {
                    source: 'AUTHORIZATION',
                    message,
                    capabilities,
                  },
                },
              });
            }
            return result;
          }
        } catch (error) {
          if (error instanceof McpAuthorizationError) {
            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: error.message }, null, 2),
                },
              ],
              isError: true,
            };
            if (shouldLogAccess) {
              await this.recordMcpAccessEvent({
                context: dispatchContext,
                surface: McpAccessSurface.TOOLS_CALL,
                operationName: name,
                outcome: McpAccessOutcome.DENY,
                latencyMs: this.elapsedMs(startedAt),
                accessLog: {
                  errorMetadata: {
                    source: 'AUTHORIZATION',
                    message: error.message,
                  },
                },
              });
            }
            return result;
          }
          if (shouldLogAccess) {
            await this.recordMcpAccessEvent({
              context: dispatchContext,
              surface: McpAccessSurface.TOOLS_CALL,
              operationName: name,
              outcome: McpAccessOutcome.ERROR,
              latencyMs: this.elapsedMs(startedAt),
              accessLog: {
                errorMetadata: {
                  source: 'HANDLER_EXCEPTION',
                  message: error.message,
                },
              },
            });
          }
          throw error;
        }

        try {
          const execution = await tool.execute(args, dispatchContext);
          const outcome =
            execution.outcome ??
            (execution.result.isError
              ? McpAccessOutcome.ERROR
              : McpAccessOutcome.SUCCESS);

          if (shouldLogAccess) {
            await this.recordMcpAccessEvent({
              context: dispatchContext,
              surface: McpAccessSurface.TOOLS_CALL,
              operationName: name,
              outcome,
              latencyMs: this.elapsedMs(startedAt),
              accessLog: execution.result.isError
                ? this.withErrorSource(execution.accessLog, 'TOOL_RESULT')
                : execution.accessLog,
            });
          }

          return execution.result;
        } catch (error) {
          if (shouldLogAccess) {
            await this.recordMcpAccessEvent({
              context: dispatchContext,
              surface: McpAccessSurface.TOOLS_CALL,
              operationName: name,
              outcome: McpAccessOutcome.ERROR,
              latencyMs: this.elapsedMs(startedAt),
              accessLog: {
                errorMetadata: {
                  source: 'HANDLER_EXCEPTION',
                  message: error.message,
                },
              },
            });
          }
          throw error;
        }
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

      server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;
        const startedAt = performance.now();
        const dispatchContext: McpContext = {
          ...context,
          correlationId: randomUUID(),
        };

        this.logger.log(`Resource requested: ${uri}`);

        try {
          const resource = this.resourceMap.get(uri);
          if (!resource) {
            throw new Error(`Unknown resource: ${uri}`);
          }

          this.authorizationService.assertAccess(
            dispatchContext.client,
            resource.requiredAccess,
            dispatchContext.grants,
            'resources/read',
          );

          const execution = await resource.read(dispatchContext);

          await this.recordMcpAccessEvent({
            context: dispatchContext,
            surface: McpAccessSurface.RESOURCES_READ,
            operationName: uri,
            outcome: McpAccessOutcome.SUCCESS,
            latencyMs: this.elapsedMs(startedAt),
            accessLog: execution.accessLog,
          });

          return execution.result;
        } catch (error) {
          await this.recordMcpAccessEvent({
            context: dispatchContext,
            surface: McpAccessSurface.RESOURCES_READ,
            operationName: uri,
            outcome:
              error instanceof McpAuthorizationError
                ? McpAccessOutcome.DENY
                : McpAccessOutcome.ERROR,
            latencyMs: this.elapsedMs(startedAt),
            accessLog: {
              errorMetadata: {
                source:
                  error instanceof McpAuthorizationError
                    ? 'AUTHORIZATION'
                    : uri && !this.resourceMap.has(uri)
                      ? 'DISPATCH'
                      : 'HANDLER_EXCEPTION',
                message: error.message,
              },
            },
          });
          throw error;
        }
      });
    } else {
      this.logger.warn('Schema resources are disabled in configuration');
    }

    return server;
  }

  private elapsedMs(startedAt: number): number {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }

  private withErrorSource(
    accessLog: McpAccessLogMetadata | undefined,
    source: string,
  ): McpAccessLogMetadata {
    const existingErrorMetadata =
      typeof accessLog?.errorMetadata === 'object' &&
      accessLog.errorMetadata !== null &&
      !Array.isArray(accessLog.errorMetadata)
        ? (accessLog.errorMetadata as Record<string, unknown>)
        : {};
    const existingSource = existingErrorMetadata.source;

    return {
      ...accessLog,
      errorMetadata: {
        ...existingErrorMetadata,
        source: typeof existingSource === 'string' ? existingSource : source,
      },
    };
  }

  private async recordMcpAccessEvent(params: {
    context: McpContext;
    surface: McpAccessSurface;
    operationName: string;
    outcome: McpAccessOutcome;
    latencyMs: number;
    accessLog?: McpAccessLogMetadata;
  }): Promise<void> {
    try {
      await this.mcpAccessLogService.record({
        userId: params.context.user.userId,
        clientKey: params.context.client.key,
        surface: params.surface,
        operationName: params.operationName,
        outcome: params.outcome,
        correlationId: params.context.correlationId ?? randomUUID(),
        latencyMs: params.latencyMs,
        requestMetadata: params.accessLog?.requestMetadata,
        responseMetadata: params.accessLog?.responseMetadata,
        errorMetadata: params.accessLog?.errorMetadata,
      });
    } catch (error) {
      this.logger.warn(`Failed to record MCP access event: ${error.message}`);
    }
  }
}
