import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { ApiKeyService } from '@/modules/auth/api-key.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = this.getRequest(context);

    const authHeader = request.headers?.['authorization'];
    if (!authHeader) {
      this.logger.warn('Missing Authorization header');
      throw new UnauthorizedException('Missing Authorization header');
    }

    if (!authHeader.startsWith('Bearer ')) {
      this.logger.warn('Authorization header is not Bearer format');
      throw new UnauthorizedException(
        'Authorization header must use Bearer scheme',
      );
    }

    const bearerToken = authHeader.slice(7);

    // Resolve userId with three-tier fallback
    let apiKey = bearerToken;
    let userId: string | undefined;
    let resolvedFrom: string | undefined;

    // Tier 1: X-User-Id header
    const headerUserId =
      request.headers?.['x-user-id'] || request.headers?.['X-User-Id'];
    if (headerUserId) {
      userId = headerUserId;
      resolvedFrom = 'header';
    }

    // Tier 2: ?asUser= query parameter
    if (!userId) {
      const queryUserId = request.query?.asUser;
      if (queryUserId) {
        userId = queryUserId;
        resolvedFrom = 'query';
      }
    }

    // Tier 3: Compound token <apiKey>.<userId>
    if (!userId) {
      const dotIndex = bearerToken.lastIndexOf('.');
      if (dotIndex > 0 && dotIndex < bearerToken.length - 1) {
        apiKey = bearerToken.substring(0, dotIndex);
        userId = bearerToken.substring(dotIndex + 1);
        resolvedFrom = 'compound';
      }
    }

    if (!userId) {
      this.logger.warn(
        'No userId resolved (checked: X-User-Id header, ?asUser param, compound token)',
      );
      throw new UnauthorizedException(
        'No userId provided. Use X-User-Id header, ?asUser query param, or compound Bearer token (<apiKey>.<userId>)',
      );
    }

    const { user, apiKeyAuth } =
      await this.apiKeyService.validateApiKeyUserContext(apiKey, userId);
    request.user = user;
    request.apiKeyAuth = apiKeyAuth;

    this.logger.debug(
      `Auth successful: user ${user.email} (resolved userId from: ${resolvedFrom})`,
    );

    return true;
  }

  private getRequest(context: ExecutionContext) {
    const contextType = context.getType<string>();
    if (contextType === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      return ctx.getContext().req;
    }
    return context.switchToHttp().getRequest();
  }
}
