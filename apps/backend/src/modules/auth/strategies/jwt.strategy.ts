import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthService } from '../auth.service';
import { HUMAN_AUTH_STRATEGY } from '../../../domains/shared/ports/human-auth.constants';
import { VerifiedHumanIdentityResolver } from '../verified-human-identity.resolver';
import { createAuth0HumanIdentityAssertion } from '../auth0-human-identity.assertion';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, HUMAN_AUTH_STRATEGY) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private authService: AuthService,
    private identityResolver: VerifiedHumanIdentityResolver,
  ) {
    const audience = configService.get<string>('auth.auth0.audience');
    const issuer = configService.get<string>('auth.auth0.issuer');
    const jwksUri = configService.get<string>('auth.auth0.jwksUri');

    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: issuer,
      algorithms: ['RS256'],
      // Don't validate audience here - we'll do it manually in validate() to support arrays
      ignoreExpiration: false,
    });

    this.logger.log('JWT Strategy initialized');
  }

  async validate(payload: any) {
    // Validate audience manually (supports both string and array)
    const expectedAudience = this.configService.get<string>(
      'auth.auth0.audience',
    );
    const tokenAudience = payload.aud;
    const audienceArray = Array.isArray(tokenAudience)
      ? tokenAudience
      : [tokenAudience];

    if (!audienceArray.includes(expectedAudience)) {
      this.logger.error('JWT audience validation failed');
      throw new UnauthorizedException('Invalid audience');
    }

    // TODO: TEMPORARY - Remove this when proper user login flow is implemented
    // This allows M2M tokens to work for testing without requiring real users
    // See docs/AUTHORIZATION_TODO.md for the proper implementation plan
    if (typeof payload.sub === 'string' && payload.sub.endsWith('@clients')) {
      this.logger.debug('Resolving an M2M compatibility principal');

      // Create or find the M2M mock user in database
      const user = await this.authService.findOrCreateM2MUser({
        provider: 'auth0',
        issuer: this.configService.get<string>('auth.auth0.issuer'),
        subject: payload.sub,
      });
      return user;
    }

    try {
      const assertion = createAuth0HumanIdentityAssertion(
        payload,
        this.configService.get<string>('auth.auth0.issuer'),
      );
      const user = await this.identityResolver.resolve(assertion);

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return user;
    } catch {
      this.logger.error('JWT human validation failed');
      throw new UnauthorizedException('Invalid token');
    }
  }
}
