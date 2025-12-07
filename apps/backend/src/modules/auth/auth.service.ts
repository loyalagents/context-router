import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from '@modules/user/user.service';
import { Auth0Service } from '@infrastructure/auth0/auth0.service';
import { ExternalIdentityService } from '@modules/external-identity/external-identity.service';
import { PrismaService } from '@infrastructure/prisma/prisma.service';

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
    private prisma: PrismaService,
  ) {}

  /**
   * Validates JWT payload and syncs user to database with race condition protection.
   * Uses transactions and retry logic to handle concurrent login attempts.
   *
   * Race condition scenarios handled:
   * 1. Multiple simultaneous first-time logins for same user
   * 2. Concurrent identity linking attempts
   *
   * See docs/LOCKING_TODO.md for implementation details.
   */
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
        // Link existing user to Auth0 identity with transaction protection
        this.logger.log(
          `Linking existing user ${user.userId} to ${provider} identity ${auth0UserId}`,
        );

        try {
          await this.externalIdentityService.linkIdentityToUser(
            user.userId,
            provider,
            auth0UserId,
          );
        } catch (error) {
          // Handle race condition: another request already linked this identity
          if (this.isUniqueConstraintError(error)) {
            this.logger.warn(
              `Identity already linked (race condition handled): ${auth0UserId}`,
            );
            // Verify it's linked to the same user
            const linkedUserId = await this.externalIdentityService.findUserIdByProviderIdentity(
              provider,
              auth0UserId,
            );
            if (linkedUserId !== user.userId) {
              throw new Error(
                `This ${provider} identity is already linked to a different user`,
              );
            }
          } else {
            throw error;
          }
        }

        return user;
      }
    }

    // User doesn't exist - create new user based on sync strategy
    const syncStrategy = this.configService.get<string>('auth.syncStrategy');

    if (syncStrategy === 'ON_LOGIN') {
      return this.createUserWithRetry(jwtPayload, provider, auth0UserId);
    }

    // For other strategies (ON_DEMAND, BACKGROUND), throw error
    throw new Error(`User not found and sync strategy is ${syncStrategy}`);
  }

  /**
   * Creates a new user with external identity in a transaction.
   * Retries on unique constraint violations to handle race conditions.
   */
  private async createUserWithRetry(
    jwtPayload: JwtPayload,
    provider: string,
    providerUserId: string,
    maxRetries = 3,
  ) {
    const email = jwtPayload.email;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `Creating new user for ${provider} identity: ${providerUserId} (attempt ${attempt}/${maxRetries})`,
        );

        // Get full user info from Auth0 if needed
        let auth0User;
        try {
          auth0User = await this.auth0Service.getUserInfo(providerUserId);
        } catch (error) {
          this.logger.warn(
            `Could not fetch Auth0 user info, using JWT payload: ${error.message}`,
          );
        }

        // Use transaction to atomically create user and link identity
        const user = await this.prisma.$transaction(async (tx) => {
          // Create user
          const newUser = await tx.user.create({
            data: {
              email: email || auth0User?.email || 'unknown@example.com',
              firstName:
                jwtPayload.given_name || auth0User?.given_name || 'Unknown',
              lastName:
                jwtPayload.family_name || auth0User?.family_name || 'User',
            },
          });

          // Link external identity to user
          await tx.externalIdentity.create({
            data: {
              userId: newUser.userId,
              provider,
              providerUserId,
              metadata: null,
            },
          });

          return newUser;
        });

        this.logger.log(`Successfully created user: ${user.userId}`);
        return user;
      } catch (error) {
        // Handle race condition: another request created the user first
        if (this.isUniqueConstraintError(error)) {
          this.logger.warn(
            `User creation conflict detected (attempt ${attempt}/${maxRetries}): ${error.message}`,
          );

          // If this is our last retry, try to fetch the existing user
          if (attempt === maxRetries) {
            this.logger.log('Max retries reached, fetching existing user');

            // Try finding by external identity first
            const userId = await this.externalIdentityService.findUserIdByProviderIdentity(
              provider,
              providerUserId,
            );

            if (userId) {
              return this.userService.findOne(userId);
            }

            // Try finding by email
            if (email) {
              const user = await this.userService.findByEmail(email);
              if (user) {
                // Ensure identity is linked
                try {
                  await this.externalIdentityService.linkIdentityToUser(
                    user.userId,
                    provider,
                    providerUserId,
                  );
                } catch (linkError) {
                  if (!this.isUniqueConstraintError(linkError)) {
                    throw linkError;
                  }
                }
                return user;
              }
            }

            throw new Error(
              'Failed to create user after max retries and could not find existing user',
            );
          }

          // Wait with exponential backoff before retrying
          const backoffMs = 100 * Math.pow(2, attempt - 1);
          this.logger.debug(`Waiting ${backoffMs}ms before retry`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // Re-throw non-constraint errors
        throw error;
      }
    }

    throw new Error('Unexpected error in createUserWithRetry');
  }

  async getCurrentUser(userId: string) {
    return this.userService.findOne(userId);
  }

  /**
   * TODO: TEMPORARY - Remove this when proper user login flow is implemented
   * This creates a mock user for M2M tokens so they can be used for testing
   * See docs/AUTHORIZATION_TODO.md for details
   *
   * Uses transaction to prevent race conditions when multiple M2M requests arrive simultaneously.
   */
  async findOrCreateM2MUser(clientId: string) {
    this.logger.log(`Finding or creating M2M mock user for: ${clientId}`);
    const email = `${clientId}@m2m.local`;

    // Try to find existing user first
    let user = await this.userService.findByEmail(email);

    if (user) {
      return user;
    }

    // User doesn't exist - create with retry logic for race conditions
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `Creating M2M mock user: ${clientId} (attempt ${attempt}/${maxRetries})`,
        );

        user = await this.userService.create({
          email,
          firstName: 'M2M',
          lastName: 'Client',
        });

        return user;
      } catch (error) {
        // Handle race condition: another request created the user
        if (this.isUniqueConstraintError(error)) {
          this.logger.warn(
            `M2M user creation conflict (attempt ${attempt}/${maxRetries})`,
          );

          // On last retry, fetch the existing user
          if (attempt === maxRetries) {
            this.logger.log('Max retries reached, fetching existing M2M user');
            user = await this.userService.findByEmail(email);
            if (user) {
              return user;
            }
            throw new Error(
              `Failed to create M2M user after max retries: ${clientId}`,
            );
          }

          // Exponential backoff
          const backoffMs = 100 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // Re-throw non-constraint errors
        throw error;
      }
    }

    throw new Error('Unexpected error in findOrCreateM2MUser');
  }

  /**
   * Helper to detect Prisma unique constraint violations.
   * These errors indicate race conditions where another request created the record first.
   */
  private isUniqueConstraintError(error: any): boolean {
    // Prisma unique constraint error code
    return error?.code === 'P2002';
  }
}
