import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ApiKeyService } from '@/modules/auth/api-key.service';

/**
 * Optional auth guard for GraphQL endpoints that allow unauthenticated access.
 * If valid auth headers are present, validates and sets request.user.
 * If auth is absent or invalid, the request proceeds with user = undefined.
 */
@Injectable()
export class OptionalGqlAuthGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = this.getRequest(context);

    try {
      const authHeader = request.headers?.['authorization'];
      if (!authHeader?.startsWith('Bearer ')) return true;

      const bearerToken = authHeader.slice(7);
      let apiKey = bearerToken;
      let userId: string | undefined;

      // Tier 1: X-User-Id header
      const headerUserId =
        request.headers?.['x-user-id'] || request.headers?.['X-User-Id'];
      if (headerUserId) {
        userId = headerUserId;
      }

      // Tier 2: ?asUser= query parameter
      if (!userId) {
        const queryUserId = request.query?.asUser;
        if (queryUserId) userId = queryUserId;
      }

      // Tier 3: Compound token <apiKey>.<userId>
      if (!userId) {
        const dotIndex = bearerToken.lastIndexOf('.');
        if (dotIndex > 0 && dotIndex < bearerToken.length - 1) {
          apiKey = bearerToken.substring(0, dotIndex);
          userId = bearerToken.substring(dotIndex + 1);
        }
      }

      if (userId) {
        const user = await this.apiKeyService.validateApiKeyAndUser(
          apiKey,
          userId,
        );
        request.user = user;
      }
    } catch {
      // Optional guard — auth failure does not block the request
    }

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
