import {
  Controller,
  Post,
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
import { McpContext } from './types/mcp-context.type';

@Controller()
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private mcpService: McpService,
    private configService: ConfigService,
  ) {}

  @Post('/mcp')
  @UseGuards(McpAuthGuard)
  async handleMcpRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: any,
  ) {
    const httpEnabled = this.configService.get('mcp.httpTransport.enabled');

    if (!httpEnabled) {
      res.status(503).json({ error: 'MCP HTTP transport is disabled' });
      return;
    }

    // Extract user from JWT (set by McpAuthGuard)
    const user = (req as any).user;

    // If no user, the guard already sent a 401 response with proper WWW-Authenticate header
    if (!user) {
      return;
    }

    // Create MCP context with authenticated user
    const context: McpContext = {
      user: {
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };

    this.logger.log(
      `MCP HTTP request from user: ${user.email} (${user.userId})`,
    );

    try {
      // Set the context for this request in the service
      // This will be used by tool handlers to access the authenticated user
      this.mcpService.setContext(context);

      // Create Streamable HTTP transport in stateless mode
      // sessionIdGenerator: undefined enables stateless operation for serverless/cloud deployments
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode - no session tracking
      });

      // Get the MCP server and connect the transport
      const server = this.mcpService.getServer();
      await server.connect(transport);

      this.logger.log(`MCP session established for user: ${user.userId}`);

      // Handle the incoming HTTP request through the transport
      // Pass the parsed body as the third parameter so the transport doesn't need to re-parse
      // The transport will handle SSE streaming or direct HTTP responses as appropriate
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
    } finally {
      // Clear the context after request completion to prevent context leakage
      this.mcpService.clearContext();
    }
  }
}
