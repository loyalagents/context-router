import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from '@modules/user/user.service';
import { Auth0Service } from '@infrastructure/auth0/auth0.service';
import { ExternalIdentityService } from '@modules/external-identity/external-identity.service';

export interface JwtPayload {
  sub: string; // Auth0 user ID (auth0|xxxxx or google-oauth2|xxxxx)
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  iat?: number;
  exp?: number;
  azp?: string;
  scope?: string;
  [key: string]: any; // For custom claims like roles
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private auth0Service: Auth0Service,
    private externalIdentityService: ExternalIdentityService,
    private configService: ConfigService,
  ) {}

  async validateAndSyncUser(jwtPayload: JwtPayload) {
    const auth0UserId = jwtPayload.sub;
    const email = jwtPayload.email;
    const provider = 'auth0';

    this.logger.log(
      `Validating user: ${provider}/${auth0UserId} (${email})`,
    );

    // Try to find user by external identity first
    const userId = await this.externalIdentityService.findUserIdByProviderIdentity(
      provider,
      auth0UserId,
    );

    if (userId) {
      const user = await this.userService.findOne(userId);
      this.logger.debug(`User found via external identity: ${user.userId}`);
      return user;
    }

    // If not found by external identity, try by email (for migration scenarios)
    let user = null;
    if (email) {
      user = await this.userService.findByEmail(email);

      if (user) {
        // Link existing user to Auth0 identity
        this.logger.log(
          `Linking existing user ${user.userId} to ${provider} identity ${auth0UserId}`,
        );
        await this.externalIdentityService.linkIdentityToUser(
          user.userId,
          provider,
          auth0UserId,
        );
        return user;
      }
    }

    // User doesn't exist - create new user based on sync strategy
    const syncStrategy = this.configService.get<string>('auth.syncStrategy');

    if (syncStrategy === 'ON_LOGIN') {
      this.logger.log(
        `Creating new user for ${provider} identity: ${auth0UserId}`,
      );

      // Get full user info from Auth0 if needed
      let auth0User;
      try {
        auth0User = await this.auth0Service.getUserInfo(auth0UserId);
      } catch (error) {
        this.logger.warn(
          `Could not fetch Auth0 user info, using JWT payload: ${error.message}`,
        );
      }

      // Create user
      user = await this.userService.create({
        email: email || auth0User?.email || 'unknown@example.com',
        firstName:
          jwtPayload.given_name || auth0User?.given_name || 'Unknown',
        lastName: jwtPayload.family_name || auth0User?.family_name || 'User',
      });

      // Link external identity to user
      await this.externalIdentityService.linkIdentityToUser(
        user.userId,
        provider,
        auth0UserId,
      );

      return user;
    }

    // For other strategies (ON_DEMAND, BACKGROUND), throw error
    throw new Error(`User not found and sync strategy is ${syncStrategy}`);
  }

  async getCurrentUser(userId: string) {
    return this.userService.findOne(userId);
  }
}
