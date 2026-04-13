import { McpAuthorizationService } from './mcp-authorization.service';
import {
  ResolvedMcpClient,
  normalizeMcpGrants,
} from '../types/mcp-authorization.types';
import { PermissionGrantService } from '../../modules/permission-grant/permission-grant.service';

function createClient(
  overrides: Partial<ResolvedMcpClient> = {},
): ResolvedMcpClient {
  return {
    key: 'claude',
    externalId: 'test-claude-client',
    policy: {
      key: 'claude',
      label: 'Claude',
      capabilities: ['preferences:read', 'preferences:write'],
      targetRules: [],
    },
    ...overrides,
  };
}

describe('McpAuthorizationService', () => {
  let service: McpAuthorizationService;
  let permissionGrantService: jest.Mocked<
    Pick<PermissionGrantService, 'evaluateAccess' | 'filterSlugsByAccess'>
  >;

  beforeEach(() => {
    permissionGrantService = {
      evaluateAccess: jest.fn(),
      filterSlugsByAccess: jest.fn(),
    };
    service = new McpAuthorizationService(
      permissionGrantService as unknown as PermissionGrantService,
    );
  });

  it('allows policy-authorized access when grant claims are absent', () => {
    const client = createClient();

    expect(
      service.canAccess(client, {
        resource: 'preferences',
        action: 'write',
      }),
    ).toBe(true);
  });

  it('treats empty or non-mcp grant sets as absent', () => {
    expect(normalizeMcpGrants([])).toBeUndefined();
    expect(normalizeMcpGrants(['openid', 'profile', 'offline_access'])).toBeUndefined();
  });

  it('intersects policy capabilities with normalized grants when present', () => {
    const client = createClient();

    expect(
      service.canAccess(
        client,
        {
          resource: 'preferences',
          action: 'write',
        },
        ['preferences:read'],
      ),
    ).toBe(false);
    expect(
      service.canAccess(
        client,
        {
          resource: 'preferences',
          action: 'read',
        },
        ['preferences:read'],
      ),
    ).toBe(true);
  });

  it('denies unknown clients with no capabilities', () => {
    const client = createClient({
      key: 'unknown',
      policy: {
        key: 'unknown',
        label: 'Unknown',
        capabilities: [],
        targetRules: [],
      },
    });

    expect(
      service.canAccess(client, {
        resource: 'preferences',
        action: 'read',
      }),
    ).toBe(false);
  });

  it('lets deny rules override allow rules for matching targets', () => {
    const client = createClient({
      policy: {
        key: 'claude',
        label: 'Claude',
        capabilities: ['preferences:read', 'preferences:write'],
        targetRules: [
          {
            effect: 'allow',
            capability: 'preferences:write',
            matcher: { namespace: 'food', slugPrefix: 'dietary' },
          },
          {
            effect: 'deny',
            capability: 'preferences:write',
            matcher: { namespace: 'food', slug: 'dietary.restricted' },
          },
        ],
      },
    });

    expect(
      service.canAccess(
        client,
        {
          resource: 'preferences',
          action: 'write',
        },
        undefined,
        { namespace: 'food', slug: 'dietary.allowed' },
      ),
    ).toBe(true);

    expect(
      service.canAccess(
        client,
        {
          resource: 'preferences',
          action: 'write',
        },
        undefined,
        { namespace: 'food', slug: 'dietary.restricted' },
      ),
    ).toBe(false);
  });

  it('denies unmatched targets when rules exist for the requested capability', () => {
    const client = createClient({
      policy: {
        key: 'claude',
        label: 'Claude',
        capabilities: ['preferences:read', 'preferences:write'],
        targetRules: [
          {
            effect: 'allow',
            capability: 'preferences:read',
            matcher: { namespace: 'food', slugPrefix: 'dietary' },
          },
        ],
      },
    });

    expect(
      service.canAccess(
        client,
        {
          resource: 'preferences',
          action: 'read',
        },
        undefined,
        { namespace: 'dev', slug: 'editor.theme' },
      ),
    ).toBe(false);
  });

  describe('canAccessTarget', () => {
    it('calls the existing target-aware coarse access path before DB grants', async () => {
      const client = createClient();
      const canAccessSpy = jest.spyOn(service, 'canAccess');
      permissionGrantService.evaluateAccess.mockResolvedValue('allow');

      await expect(
        service.canAccessTarget(
          client,
          {
            resource: 'preferences',
            action: 'read',
          },
          undefined,
          'user-1',
          { slug: 'food.dietary_restrictions' },
        ),
      ).resolves.toBe(true);

      expect(canAccessSpy).toHaveBeenCalledWith(
        client,
        { resource: 'preferences', action: 'read' },
        undefined,
        { slug: 'food.dietary_restrictions' },
      );
    });

    it('short-circuits before DB grants when static target rules deny access', async () => {
      const client = createClient({
        policy: {
          key: 'claude',
          label: 'Claude',
          capabilities: ['preferences:read', 'preferences:write'],
          targetRules: [
            {
              effect: 'deny',
              capability: 'preferences:read',
              matcher: { slug: 'food.dietary_restrictions' },
            },
          ],
        },
      });

      await expect(
        service.canAccessTarget(
          client,
          {
            resource: 'preferences',
            action: 'read',
          },
          undefined,
          'user-1',
          { slug: 'food.dietary_restrictions' },
        ),
      ).resolves.toBe(false);

      expect(permissionGrantService.evaluateAccess).not.toHaveBeenCalled();
    });

    it('lets DB deny narrow past a static allow', async () => {
      const client = createClient({
        policy: {
          key: 'claude',
          label: 'Claude',
          capabilities: ['preferences:read', 'preferences:write'],
          targetRules: [
            {
              effect: 'allow',
              capability: 'preferences:read',
              matcher: { slugPrefix: 'food.' },
            },
          ],
        },
      });
      permissionGrantService.evaluateAccess.mockResolvedValue('deny');

      await expect(
        service.canAccessTarget(
          client,
          {
            resource: 'preferences',
            action: 'read',
          },
          undefined,
          'user-1',
          { slug: 'food.dietary_restrictions' },
        ),
      ).resolves.toBe(false);
    });

    it('does not let DB allow widen past a static deny', async () => {
      const client = createClient({
        policy: {
          key: 'claude',
          label: 'Claude',
          capabilities: ['preferences:read', 'preferences:write'],
          targetRules: [
            {
              effect: 'deny',
              capability: 'preferences:read',
              matcher: { slug: 'food.dietary_restrictions' },
            },
          ],
        },
      });
      permissionGrantService.evaluateAccess.mockResolvedValue('allow');

      await expect(
        service.canAccessTarget(
          client,
          {
            resource: 'preferences',
            action: 'read',
          },
          undefined,
          'user-1',
          { slug: 'food.dietary_restrictions' },
        ),
      ).resolves.toBe(false);
    });

    it('defaults to allow when no DB grant matches', async () => {
      const client = createClient();
      permissionGrantService.evaluateAccess.mockResolvedValue('no-grant');

      await expect(
        service.canAccessTarget(
          client,
          {
            resource: 'preferences',
            action: 'read',
          },
          undefined,
          'user-1',
          { slug: 'system.response_tone' },
        ),
      ).resolves.toBe(true);
    });
  });

  describe('filterByTargetAccess', () => {
    it('filters slugs using coarse access first, then DB grants', async () => {
      const client = createClient();
      permissionGrantService.filterSlugsByAccess.mockResolvedValue([
        'food.dietary_restrictions',
      ]);

      await expect(
        service.filterByTargetAccess(
          client,
          {
            resource: 'preferences',
            action: 'read',
          },
          undefined,
          'user-1',
          ['food.dietary_restrictions', 'system.response_tone'],
        ),
      ).resolves.toEqual(['food.dietary_restrictions']);

      expect(permissionGrantService.filterSlugsByAccess).toHaveBeenCalledWith(
        'user-1',
        'claude',
        'read',
        ['food.dietary_restrictions', 'system.response_tone'],
      );
    });
  });
});
