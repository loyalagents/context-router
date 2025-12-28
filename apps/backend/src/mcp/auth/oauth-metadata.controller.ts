import { Controller, Get, Header, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OAuth Metadata Controller
 *
 * Implements RFC 9728 (OAuth Protected Resource Metadata) and
 * RFC 8414 (OAuth Authorization Server Metadata) for MCP OAuth flow.
 *
 * These endpoints enable Claude and ChatGPT to discover how to authenticate
 * with our MCP server without manual token configuration.
 */
@Controller('.well-known')
export class OAuthMetadataController {
  private readonly logger = new Logger(OAuthMetadataController.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Protected Resource Metadata (PRM)
   * RFC 9728: https://datatracker.ietf.org/doc/html/rfc9728
   *
   * Tells MCP clients:
   * - What resource this server protects
   * - Where to find the authorization server
   * - What scopes are supported
   */
  @Get('oauth-protected-resource')
  @Header('Content-Type', 'application/json')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=3600')
  getProtectedResourceMetadata() {
    return this.buildProtectedResourceMetadata();
  }

  /**
   * Path-specific Protected Resource Metadata
   * RFC 9728 Section 3: Clients may request path-specific metadata
   *
   * When the resource is at /mcp, clients look for /.well-known/oauth-protected-resource/mcp
   */
  @Get('oauth-protected-resource/mcp')
  @Header('Content-Type', 'application/json')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=3600')
  getProtectedResourceMetadataForMcp() {
    return this.buildProtectedResourceMetadata();
  }

  private buildProtectedResourceMetadata() {
    const resource = this.configService.get<string>('mcp.oauth.resource');

    if (!resource) {
      this.logger.error(
        'MCP_RESOURCE or AUTH0_AUDIENCE not configured - PRM endpoint will return incomplete data',
      );
    }

    const metadata = {
      resource: resource,
      authorization_servers: [resource],
      scopes_supported: this.configService.get<string[]>('mcp.oauth.scopes'),
    };

    this.logger.debug('Serving Protected Resource Metadata', metadata);
    return metadata;
  }

  /**
   * OAuth Authorization Server Metadata
   * RFC 8414: https://datatracker.ietf.org/doc/html/rfc8414
   *
   * Tells MCP clients:
   * - Where to send authorization requests (Auth0)
   * - Where to exchange tokens (Auth0)
   * - Where to register as a client (our DCR shim)
   * - What grant types and code challenges are supported
   *
   * Note: The "issuer" here is our domain (discovery issuer), but tokens
   * will have Auth0's domain as their "iss" claim (token issuer).
   * This is the Path A2 pattern - see MCP_WITH_AUTH_PLAN.md section 4.1.
   */
  @Get('oauth-authorization-server')
  @Header('Content-Type', 'application/json')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=3600')
  getAuthorizationServerMetadata() {
    return this.buildAuthorizationServerMetadata();
  }

  /**
   * Path-specific Authorization Server Metadata
   * Some clients look for /.well-known/oauth-authorization-server/mcp
   */
  @Get('oauth-authorization-server/mcp')
  @Header('Content-Type', 'application/json')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=3600')
  getAuthorizationServerMetadataForMcp() {
    return this.buildAuthorizationServerMetadata();
  }

  private buildAuthorizationServerMetadata() {
    const resource = this.configService.get<string>('mcp.oauth.resource');
    const serverUrl = this.configService.get<string>('mcp.oauth.serverUrl');
    const authorizationEndpoint = this.configService.get<string>(
      'mcp.oauth.auth0.authorizationEndpoint',
    );
    const tokenEndpoint = this.configService.get<string>(
      'mcp.oauth.auth0.tokenEndpoint',
    );
    const jwksUri = this.configService.get<string>('mcp.oauth.auth0.jwksUri');

    if (!authorizationEndpoint || !tokenEndpoint) {
      this.logger.error(
        'AUTH0_DOMAIN not configured - OAuth metadata endpoint will return incomplete data',
      );
    }

    if (!serverUrl) {
      this.logger.error(
        'MCP_SERVER_URL not configured - registration_endpoint will be invalid',
      );
    }

    const metadata = {
      // Discovery issuer = our domain (not Auth0)
      issuer: resource,

      // Auth0 handles actual authorization and token exchange
      authorization_endpoint: authorizationEndpoint,
      token_endpoint: tokenEndpoint,
      jwks_uri: jwksUri,

      // Our DCR shim handles client registration (must be actual server URL, not Auth0 audience)
      registration_endpoint: `${serverUrl}/oauth/register`,

      // OAuth capabilities
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'], // Public client (PKCE)
      code_challenge_methods_supported: ['S256'], // PKCE required

      // Scopes
      scopes_supported: this.configService.get<string[]>('mcp.oauth.scopes'),
    };

    this.logger.debug('Serving Authorization Server Metadata', metadata);
    return metadata;
  }
}
