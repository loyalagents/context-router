import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { JwksClient } from 'jwks-rsa';
import { AuthService } from '@/modules/auth/auth.service';

// Simple JWT decode without verification (just to read header/payload)
function decodeJwt(token: string): { header: any; payload: any } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    return { header, payload };
  } catch {
    return null;
  }
}

// Simple JWT signature verification using Node's crypto
async function verifyJwtSignature(
  token: string,
  publicKey: string,
): Promise<boolean> {
  const crypto = await import('crypto');
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const signatureInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], 'base64url');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signatureInput);

  return verifier.verify(publicKey, signature);
}

/**
 * MCP Authentication Guard
 *
 * Validates Auth0 JWTs for MCP endpoints and returns proper OAuth challenges.
 *
 * Unlike the standard JwtAuthGuard, this guard:
 * 1. Returns RFC 6750 WWW-Authenticate challenges on 401/403
 * 2. Includes resource_metadata URL for MCP client discovery
 * 3. Does NOT throw exceptions - it writes responses directly for proper headers
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly logger = new Logger(McpAuthGuard.name);
  private readonly jwksClient: JwksClient;
  private readonly issuer: string;
  private readonly expectedAudience: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const auth0Domain = this.configService.get<string>('auth.auth0.domain');

    this.jwksClient = new JwksClient({
      jwksUri: `https://${auth0Domain}/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
    });

    this.issuer = this.configService.get<string>('auth.auth0.issuer');
    this.expectedAudience = this.configService.get<string>('auth.auth0.audience');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const authHeader = request.headers.authorization;

    // No token provided - return 401 with discovery challenge
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.sendAuthChallenge(response, 401, 'missing_token');
      return false;
    }

    const token = authHeader.substring(7);

    try {
      // Verify the token
      const payload = await this.verifyToken(token);

      // Extract scopes from token
      const scopes = this.extractScopes(payload);

      // Sync/retrieve user from local database (same as existing JwtStrategy)
      let user;
      if (payload.sub && payload.sub.endsWith('@clients')) {
        // M2M token
        user = await this.authService.findOrCreateM2MUser(payload.sub);
      } else {
        user = await this.authService.validateAndSyncUser(payload);
      }

      if (!user) {
        this.sendAuthChallenge(response, 401, 'invalid_token', 'User not found');
        return false;
      }

      // Attach user and scopes to request for downstream use
      (request as any).user = user;
      (request as any).tokenScopes = scopes;
      (request as any).tokenPayload = payload;

      return true;
    } catch (error) {
      this.logger.warn(`Token verification failed: ${error.message}`);
      this.sendAuthChallenge(response, 401, 'invalid_token', error.message);
      return false;
    }
  }

  /**
   * Verify JWT using Auth0 JWKS
   */
  private async verifyToken(token: string): Promise<any> {
    // Decode token without verification to get header and payload
    const decoded = decodeJwt(token);
    if (!decoded) {
      throw new Error('Invalid token format');
    }

    const { header, payload } = decoded;

    // Validate issuer
    if (payload.iss !== this.issuer) {
      throw new Error(
        `Invalid issuer. Expected: ${this.issuer}, Got: ${payload.iss}`,
      );
    }

    // Validate audience
    const tokenAudience = payload.aud;
    const audienceArray = Array.isArray(tokenAudience)
      ? tokenAudience
      : [tokenAudience];

    if (!audienceArray.includes(this.expectedAudience)) {
      throw new Error(
        `Invalid audience. Expected: ${this.expectedAudience}, Got: ${JSON.stringify(tokenAudience)}`,
      );
    }

    // Check token expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      throw new Error('Token expired');
    }

    // Check not-before time
    if (payload.nbf && payload.nbf * 1000 > Date.now()) {
      throw new Error('Token not yet valid');
    }

    // Get signing key from JWKS
    if (!header.kid) {
      throw new Error('Token missing key ID (kid)');
    }

    const signingKey = await this.jwksClient.getSigningKey(header.kid);
    const publicKey = signingKey.getPublicKey();

    // Verify signature
    const isValid = await verifyJwtSignature(token, publicKey);
    if (!isValid) {
      throw new Error('Invalid token signature');
    }

    return payload;
  }

  /**
   * Extract scopes from token payload.
   * Auth0 can put scopes in different places depending on configuration.
   */
  private extractScopes(payload: any): string[] {
    // Check 'scope' claim (space-separated string)
    if (payload.scope && typeof payload.scope === 'string') {
      return payload.scope.split(' ').filter(Boolean);
    }

    // Check 'permissions' claim (array of strings - RBAC)
    if (Array.isArray(payload.permissions)) {
      return payload.permissions;
    }

    return [];
  }

  /**
   * Send an OAuth WWW-Authenticate challenge response.
   */
  private sendAuthChallenge(
    response: Response,
    status: 401 | 403,
    error: string,
    errorDescription?: string,
  ): void {
    const resource = this.configService.get<string>('mcp.oauth.resource');
    const resourceMetadata = `${resource}/.well-known/oauth-protected-resource`;

    // Build WWW-Authenticate header
    const parts = [`Bearer resource_metadata="${resourceMetadata}"`];

    if (error === 'insufficient_scope') {
      parts.push(`error="insufficient_scope"`);
      parts.push(`scope="preferences:write"`);
    } else if (error !== 'missing_token') {
      parts.push(`error="${error}"`);
    }

    if (errorDescription) {
      parts.push(`error_description="${errorDescription}"`);
    }

    // Default scope hint
    if (error === 'missing_token') {
      parts.push(`scope="preferences:read"`);
    }

    response.setHeader('WWW-Authenticate', parts.join(', '));
    response.status(status).json({
      error: error,
      error_description: errorDescription || 'Authentication required',
    });
  }

  /**
   * Send an insufficient scope challenge (403).
   * This can be called by the MCP service when a specific tool requires more scopes.
   */
  sendInsufficientScopeChallenge(
    response: Response,
    requiredScope: string,
  ): void {
    const resource = this.configService.get<string>('mcp.oauth.resource');
    const resourceMetadata = `${resource}/.well-known/oauth-protected-resource`;

    response.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${resourceMetadata}", error="insufficient_scope", scope="${requiredScope}"`,
    );
    response.status(403).json({
      error: 'insufficient_scope',
      error_description: `This operation requires the '${requiredScope}' scope`,
    });
  }
}
