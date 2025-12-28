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
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DcrRateLimitGuard } from './dcr-rate-limit.guard';

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

  constructor(private readonly configService: ConfigService) {}

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

    // Get the allowlist from config
    const allowedRedirectUris = this.configService.get<string[]>(
      'mcp.oauth.allowedRedirectUris',
      [],
    );

    // Check if a URI matches the allowlist
    // For localhost URIs, we allow any port and path (for desktop app OAuth flows)
    const isUriAllowed = (uri: string): boolean => {
      // Exact match
      if (allowedRedirectUris.includes(uri)) {
        return true;
      }

      // For localhost/127.0.0.1 URIs, allow any port and any path
      // Desktop apps use dynamic ports and may use different callback paths
      try {
        const url = new URL(uri);
        if (
          url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
        ) {
          // Allow ANY localhost/127.0.0.1 URL for desktop app OAuth
          // This is safe because these URLs can only redirect to the local machine
          return true;
        }
      } catch {
        // Invalid URL, not allowed
      }

      return false;
    };

    // Compute intersection: requested ∩ allowlist (with localhost port flexibility)
    const validRedirectUris = requestedRedirectUris.filter(isUriAllowed);

    // Log the request (sanitized)
    this.logger.log(
      `DCR request - Requested URIs: ${requestedRedirectUris.length}, Valid URIs: ${validRedirectUris.length}`,
    );

    // If no valid redirect URIs, reject with 400
    if (validRedirectUris.length === 0) {
      // Log full URIs to help debug what clients are actually sending
      this.logger.warn(
        `DCR rejected - no valid redirect_uris. Requested: ${JSON.stringify(requestedRedirectUris)}`,
      );
      this.logger.warn(
        `Allowed redirect_uris: ${JSON.stringify(allowedRedirectUris)}`,
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

    // Get the static client_id from config
    const clientId = this.configService.get<string>(
      'mcp.oauth.publicClientId',
    );

    if (!clientId) {
      this.logger.error(
        'AUTH0_MCP_PUBLIC_CLIENT_ID not configured - DCR shim cannot function',
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
      redirect_uris: validRedirectUris,
    };

    this.logger.log(
      `DCR successful - client_id: ${clientId.substring(0, 8)}..., redirect_uris: ${validRedirectUris.length}`,
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
