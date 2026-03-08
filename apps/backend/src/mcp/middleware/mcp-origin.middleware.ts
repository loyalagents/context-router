import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

/**
 * Origin validation middleware for the /mcp endpoint.
 *
 * The MCP Streamable HTTP transport spec requires servers to validate the
 * Origin header on incoming HTTP connections to prevent DNS-rebinding attacks.
 * When using a raw Nest controller (rather than the SDK's prebuilt Express
 * helper), this must be implemented explicitly.
 *
 * Policy:
 * - Requests with no Origin header (non-browser clients: CLI tools, curl,
 *   native MCP clients) are allowed through unconditionally. DNS-rebinding
 *   attacks require a browser, so missing Origin is not a security concern.
 * - Requests with an Origin header are validated against the allowlist from
 *   mcp.httpTransport.allowedOrigins (env: MCP_HTTP_ALLOWED_ORIGINS).
 * - If the allowlist contains '*', all origins are permitted (default for
 *   local dev / tests).
 * - Non-matching origins receive 403 Forbidden.
 */
@Injectable()
export class McpOriginMiddleware implements NestMiddleware {
  private readonly logger = new Logger(McpOriginMiddleware.name);
  private readonly allowedOrigins: string[];

  constructor(private configService: ConfigService) {
    this.allowedOrigins = this.configService.get<string[]>(
      'mcp.httpTransport.allowedOrigins',
    ) ?? ['*'];
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers['origin'];

    // Non-browser clients omit Origin — allow through
    if (!origin) {
      return next();
    }

    // Wildcard allows all origins
    if (this.allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      return next();
    }

    if (this.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      return next();
    }

    this.logger.warn(`MCP request rejected: disallowed origin "${origin}"`);
    res.status(403).json({ error: 'Origin not allowed' });
  }
}
