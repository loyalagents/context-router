import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const auth0Domain = configService.get<string>('auth.auth0.domain');
    const audience = configService.get<string>('auth.auth0.audience');
    const issuer = configService.get<string>('auth.auth0.issuer');

    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${auth0Domain}/.well-known/jwks.json`,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: issuer,
      algorithms: ['RS256'],
      // Don't validate audience here - we'll do it manually in validate() to support arrays
      ignoreExpiration: false,
    });

    this.logger.log('JWT Strategy Configuration:');
    this.logger.log(`  Domain: ${auth0Domain}`);
    this.logger.log(`  Audience: ${audience}`);
    this.logger.log(`  Issuer: ${issuer}`);
    this.logger.log(`  JWKS URI: https://${auth0Domain}/.well-known/jwks.json`);
    this.logger.log('JWT Strategy initialized');
  }

  async validate(payload: any) {
    this.logger.debug(`Validating JWT for user: ${payload.sub}`);

    // Validate audience manually (supports both string and array)
    const expectedAudience = this.configService.get<string>('auth.auth0.audience');
    const tokenAudience = payload.aud;
    const audienceArray = Array.isArray(tokenAudience) ? tokenAudience : [tokenAudience];

    if (!audienceArray.includes(expectedAudience)) {
      this.logger.error(`Invalid audience. Expected: ${expectedAudience}, Got: ${JSON.stringify(tokenAudience)}`);
      throw new UnauthorizedException('Invalid audience');
    }

    // TODO: TEMPORARY - Remove this when proper user login flow is implemented
    // This allows M2M tokens to work for testing without requiring real users
    // See docs/AUTHORIZATION_TODO.md for the proper implementation plan
    if (payload.sub && payload.sub.endsWith('@clients')) {
      this.logger.log('M2M token detected, creating/finding mock user (TEMPORARY)');

      // Create or find the M2M mock user in database
      const user = await this.authService.findOrCreateM2MUser(payload.sub);
      return user;
    }

    try {
      // Sync/retrieve user from local database
      const user = await this.authService.validateAndSyncUser(payload);

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return user;
    } catch (error) {
      this.logger.error('JWT validation failed', error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
