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
      this.logger.debug('Fetching Auth0 user profile');
      return await this.managementClient.users.get(auth0UserId);
    } catch (error) {
      this.logger.error('Auth0 user profile request failed');
      throw error;
    }
  }

  async updateUserMetadata(auth0UserId: string, metadata: any) {
    try {
      this.logger.debug('Updating Auth0 user metadata');
      return await this.managementClient.users.update(
        auth0UserId,
        { user_metadata: metadata },
      );
    } catch (error) {
      this.logger.error('Auth0 user metadata request failed');
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
