import {
  Controller,
  Post,
  Body,
  Header,
  Logger,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { DcrRateLimitGuard } from './dcr-rate-limit.guard';
import { McpClientRegistry } from './mcp-client-registry.service';

/**
 * DCR Shim Controller
 *
 * Implements a minimal Dynamic Client Registration (RFC 7591) shim
 * that returns a pre-registered Auth0 public client_id.
 *
 * This allows MCP clients (Claude, ChatGPT) to "register" without
 * enabling Auth0's full DCR, which would be a security risk.
 *
 * Security:
 * - Strict redirect_uri allowlist prevents open redirect attacks
 * - Rate limited to prevent abuse
 * - Stateless (no DB writes)
 */
@Controller('oauth')
export class DcrShimController {
  private readonly logger = new Logger(DcrShimController.name);

  constructor(private readonly clientRegistry: McpClientRegistry) {}

  @Post('register')
  @UseGuards(DcrRateLimitGuard)
  @Header('Content-Type', 'application/json')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  @Header('Access-Control-Allow-Headers', 'Content-Type')
  @Header('Cache-Control', 'no-store')
  registerClient(@Body() body: any, @Req() req: Request) {
    const clientIp = this.getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    this.logger.log(
      `DCR registration request from IP: ${clientIp}, UA: ${userAgent.substring(0, 50)}`,
    );

    // Extract redirect_uris from body - handle various formats
    let requestedRedirectUris: string[] = [];
    if (Array.isArray(body.redirect_uris)) {
      requestedRedirectUris = body.redirect_uris;
    } else if (typeof body.redirect_uris === 'string') {
      requestedRedirectUris = [body.redirect_uris];
    } else if (Array.isArray(body.redirect_uri)) {
      // Some clients might use singular form as array
      requestedRedirectUris = body.redirect_uri;
    } else if (typeof body.redirect_uri === 'string') {
      // Some clients might use singular form
      requestedRedirectUris = [body.redirect_uri];
    }

    // Log the request (sanitized)
    this.logger.log(
      `DCR request - Requested URIs: ${requestedRedirectUris.length}`,
    );

    const resolution = this.clientRegistry.resolveForDcr(requestedRedirectUris);

    if (resolution.status === 'empty') {
      throw new HttpException(
        {
          error: 'invalid_redirect_uri',
          error_description:
            'At least one redirect_uri must be provided for OAuth client registration.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (resolution.status === 'invalid') {
      this.logger.warn(
        `DCR rejected - invalid redirect_uris: ${JSON.stringify(requestedRedirectUris)}`,
      );
      throw new HttpException(
        {
          error: 'invalid_redirect_uri',
          error_description:
            'None of the requested redirect_uris are allowed. ' +
            'This server only accepts connections from authorized MCP clients.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (resolution.status === 'mixed') {
      this.logger.warn(
        `DCR rejected - mixed redirect_uri buckets: ${JSON.stringify(requestedRedirectUris)}`,
      );
      throw new HttpException(
        {
          error: 'invalid_redirect_uri',
          error_description:
            'All requested redirect_uris must belong to the same supported MCP client.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = resolution.client;
    const clientId = client.oauth?.clientId;
    if (!clientId) {
      this.logger.error(
        `DCR resolved client "${client.key}" without an OAuth client ID`,
      );
      throw new HttpException(
        {
          error: 'server_error',
          error_description: 'OAuth client registration is not configured',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Return the static registration response
    const response = {
      client_id: clientId,
      token_endpoint_auth_method: 'none', // Public client (PKCE)
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: requestedRedirectUris,
    };

    this.logger.log(
      `DCR successful - client: ${client.key}, redirect_uris: ${requestedRedirectUris.length}`,
    );

    return response;
  }

  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(',')[0];
      return ips.trim();
    }
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
