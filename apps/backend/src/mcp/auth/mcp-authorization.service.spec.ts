import { McpAuthorizationService } from './mcp-authorization.service';
import { ResolvedMcpClient } from '../types/mcp-authorization.types';

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

  beforeEach(() => {
    service = new McpAuthorizationService();
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
});
