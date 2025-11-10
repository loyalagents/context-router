import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManagementClient, AuthenticationClient } from 'auth0';

@Injectable()
export class Auth0Service {
  private readonly logger = new Logger(Auth0Service.name);
  private managementClient: ManagementClient;
  private authClient: AuthenticationClient;

  constructor(private configService: ConfigService) {
    const domain = this.configService.get<string>('auth.auth0.domain');
    const clientId = this.configService.get<string>('auth.auth0.clientId');
    const clientSecret = this.configService.get<string>(
      'auth.auth0.clientSecret',
    );

    this.managementClient = new ManagementClient({
      domain,
      clientId,
      clientSecret,
    });

    this.authClient = new AuthenticationClient({
      domain,
      clientId,
      clientSecret,
    });

    this.logger.log('Auth0 service initialized');
  }

  async getUserInfo(auth0UserId: string) {
    try {
      this.logger.debug(`Fetching user info for: ${auth0UserId}`);
      return await this.managementClient.users.get({ id: auth0UserId });
    } catch (error) {
      this.logger.error(`Failed to get user info for ${auth0UserId}`, error);
      throw error;
    }
  }

  async updateUserMetadata(auth0UserId: string, metadata: any) {
    try {
      this.logger.debug(`Updating metadata for: ${auth0UserId}`);
      return await this.managementClient.users.update(
        { id: auth0UserId },
        { user_metadata: metadata },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update metadata for ${auth0UserId}`,
        error,
      );
      throw error;
    }
  }

  getManagementClient(): ManagementClient {
    return this.managementClient;
  }

  getAuthClient(): AuthenticationClient {
    return this.authClient;
  }
}
