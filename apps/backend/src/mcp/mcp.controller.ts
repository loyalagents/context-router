import {
  Controller,
  Post,
  Get,
  Req,
  Res,
  Body,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { McpClientRegistry } from './auth/mcp-client-registry.service';
import { McpContext } from './types/mcp-context.type';

@Controller()
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private mcpService: McpService,
    private configService: ConfigService,
    private clientRegistry: McpClientRegistry,
  ) {}

  /**
   * Handle MCP POST requests (JSON-RPC).
   * JSON-response mode (enableJsonResponse: true) is used — this is a stateless,
   * request/response endpoint. GET is intentionally not supported; the transport
   * will return 405 for GET requests, which is the correct behavior for this mode.
   * If server-initiated streaming (notifications, sampling, elicitation) is needed
   * in the future, the transport design must be revisited.
   */
  @Post('/mcp')
  @UseGuards(McpAuthGuard)
  async handleMcpPost(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: any,
  ) {
    return this.handleMcpRequest(req, res, body);
  }

  /**
   * GET /mcp — not supported in JSON-response mode.
   * Returns 405 Method Not Allowed explicitly.
   */
  @Get('/mcp')
  handleMcpGet(@Res() res: Response) {
    res.status(405).set('Allow', 'POST').json({ error: 'Method Not Allowed' });
  }

  private async handleMcpRequest(req: Request, res: Response, body: any) {
    const httpEnabled = this.configService.get('mcp.httpTransport.enabled');

    if (!httpEnabled) {
      res.status(503).json({ error: 'MCP HTTP transport is disabled' });
      return;
    }

    const user = (req as any).user;
    const tokenPayload = (req as any).tokenPayload;
    const tokenGrants = (req as any).tokenGrants;

    if (!user) {
      return;
    }

    const client = this.clientRegistry.resolveFromTokenPayload(tokenPayload);
    const context: McpContext = {
      user: {
        userId: user.userId,
        email: user.email,
      },
      client,
      grants: tokenGrants,
    };

    this.logger.log(
      `MCP HTTP request from user: ${user.email} (${user.userId}), client: ${client.key}`,
    );

    const server = this.mcpService.createServer(context);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      this.logger.log(`MCP request completed for user: ${user.userId}`);
    } catch (error) {
      this.logger.error(
        `Error handling MCP request: ${error.message}`,
        error.stack,
      );

      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to handle MCP request' });
      }
    }
  }
}
