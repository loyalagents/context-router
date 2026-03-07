import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from '@/modules/auth/api-key.service';

describe('ApiKeyGuard', () => {
  const mockUser = {
    userId: 'user-1',
    email: 'guard@example.com',
    firstName: 'Guard',
    lastName: 'Test',
  };

  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let apiKeyService: jest.Mocked<Pick<ApiKeyService, 'validateApiKeyAndUser'>>;
  let guard: ApiKeyGuard;
  let request: {
    headers: Record<string, string>;
    query: Record<string, string>;
    user?: unknown;
  };
  let context: ExecutionContext;

  function createGraphqlContext(): ExecutionContext {
    return {
      getType: jest.fn().mockReturnValue('graphql'),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    apiKeyService = {
      validateApiKeyAndUser: jest.fn().mockResolvedValue(mockUser),
    };
    guard = new ApiKeyGuard(
      reflector as unknown as Reflector,
      apiKeyService as unknown as ApiKeyService,
    );
    request = {
      headers: {},
      query: {},
    };
    context = createGraphqlContext();

    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req: request }),
    } as unknown as GqlExecutionContext);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bypasses auth for public handlers', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(apiKeyService.validateApiKeyAndUser).not.toHaveBeenCalled();
  });

  it('resolves the user from the x-user-id header', async () => {
    request.headers.authorization = 'Bearer grp-a-abc123';
    request.headers['x-user-id'] = mockUser.userId;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(apiKeyService.validateApiKeyAndUser).toHaveBeenCalledWith(
      'grp-a-abc123',
      mockUser.userId,
    );
    expect(request.user).toEqual(mockUser);
  });

  it('falls back to the asUser query parameter', async () => {
    request.headers.authorization = 'Bearer grp-a-abc123';
    request.query.asUser = mockUser.userId;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(apiKeyService.validateApiKeyAndUser).toHaveBeenCalledWith(
      'grp-a-abc123',
      mockUser.userId,
    );
  });

  it('falls back to a compound bearer token', async () => {
    request.headers.authorization = `Bearer grp-a-abc123.${mockUser.userId}`;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(apiKeyService.validateApiKeyAndUser).toHaveBeenCalledWith(
      'grp-a-abc123',
      mockUser.userId,
    );
  });

  it('rejects bearer tokens without any user identity', async () => {
    request.headers.authorization = 'Bearer grp-a-abc123';

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'No userId provided. Use X-User-Id header, ?asUser query param, or compound Bearer token (<apiKey>.<userId>)',
      ),
    );

    expect(apiKeyService.validateApiKeyAndUser).not.toHaveBeenCalled();
  });
});
