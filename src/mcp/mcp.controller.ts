import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpService } from './mcp.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { McpContext } from './types/mcp-context.type';

@Controller()
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private mcpService: McpService,
    private configService: ConfigService,
  ) {}

  @Post('/mcp')
  @UseGuards(JwtAuthGuard)
  async handleMcpRequest(@Req() req: Request, @Res() res: Response) {
    const httpEnabled = this.configService.get('mcp.httpTransport.enabled');

    if (!httpEnabled) {
      res.status(503).json({ error: 'MCP HTTP transport is disabled' });
      return;
    }

    // Extract user from JWT (set by JwtAuthGuard)
    const user = (req as any).user;

    if (!user) {
      this.logger.error('MCP request without authenticated user');
      res.status(401).json({ error: 'Authentication required' });
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
      // Create SSE transport
      const transport = new SSEServerTransport('/mcp', res);

      // Attach context to all requests
      // This allows tools to access the authenticated user
      const server = this.mcpService.getServer();

      // Wrap the server's request handling to inject context
      const originalConnect = server.connect.bind(server);
      server.connect = function (transport) {
        // Inject context into transport
        (transport as any).context = context;
        return originalConnect(transport);
      };

      // Connect the transport to the MCP server
      await server.connect(transport);

      this.logger.log(`MCP session established for user: ${user.userId}`);

      // The SSE connection is now active
      // It will remain open until the client disconnects
      res.on('close', () => {
        this.logger.log(`MCP session closed for user: ${user.userId}`);
      });
    } catch (error) {
      this.logger.error(
        `Error establishing MCP connection: ${error.message}`,
        error.stack,
      );

      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish MCP connection' });
      }
    }
  }
}
