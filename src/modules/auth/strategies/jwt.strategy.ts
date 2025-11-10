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
      audience: audience,
      issuer: issuer,
      algorithms: ['RS256'],
    });

    this.logger.log('JWT Strategy initialized');
  }

  async validate(payload: any) {
    this.logger.debug(`Validating JWT for user: ${payload.sub}`);

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
