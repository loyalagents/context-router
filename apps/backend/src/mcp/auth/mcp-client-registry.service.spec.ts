import { ConfigService } from '@nestjs/config';
import { McpClientRegistry } from './mcp-client-registry.service';
import { McpClientConfig } from '../types/mcp-authorization.types';

const TEST_CLIENTS: McpClientConfig[] = [
  {
    key: 'claude',
    label: 'Claude',
    capabilities: ['preferences:read', 'preferences:write'],
    targetRules: [],
    oauth: {
      clientId: 'claude-client-id',
      redirectUris: ['http://localhost:8081/callback'],
    },
  },
  {
    key: 'codex',
    label: 'Codex',
    capabilities: ['preferences:read'],
    targetRules: [],
    oauth: {
      clientId: 'codex-client-id',
      redirectUris: ['http://127.0.0.1:8082/callback'],
    },
  },
  {
    key: 'fallback',
    label: 'Fallback',
    capabilities: ['preferences:read'],
    targetRules: [],
    oauth: {
      clientId: 'fallback-client-id',
      redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    },
  },
  {
    key: 'unknown',
    label: 'Unknown',
    capabilities: [],
    targetRules: [],
  },
];

function createRegistry(clients: McpClientConfig[] = TEST_CLIENTS) {
  const configService = {
    get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'mcp.clients') {
        return clients;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;

  const registry = new McpClientRegistry(configService);
  registry.onModuleInit();
  return registry;
}

describe('McpClientRegistry', () => {
  it('resolves clients directly from shared client keys', () => {
    const registry = createRegistry();

    expect(registry.resolveFromClientKey('claude')).toMatchObject({
      key: 'claude',
      policy: expect.objectContaining({ key: 'claude' }),
    });
    expect(registry.resolveFromClientKey('unknown')).toMatchObject({
      key: 'unknown',
      policy: expect.objectContaining({ key: 'unknown' }),
    });
  });

  it('resolves clients from stable token claims', () => {
    const registry = createRegistry();

    expect(
      registry.resolveFromTokenPayload({ azp: 'claude-client-id' }).key,
    ).toBe('claude');
    expect(
      registry.resolveFromTokenPayload({ client_id: 'codex-client-id' }).key,
    ).toBe('codex');
    expect(
      registry.resolveFromTokenPayload({ sub: 'fallback-client-id@clients' }).key,
    ).toBe('fallback');
  });

  it('maps missing or unmapped token claims to unknown', () => {
    const registry = createRegistry();

    expect(registry.resolveFromTokenPayload(undefined).key).toBe('unknown');
    expect(
      registry.resolveFromTokenPayload({ azp: 'unmapped-client-id' }).key,
    ).toBe('unknown');
  });

  it('routes DCR requests by exact redirect URI bucket', () => {
    const registry = createRegistry();

    expect(
      registry.resolveForDcr(['http://localhost:8081/callback']),
    ).toMatchObject({
      status: 'ok',
      client: expect.objectContaining({ key: 'claude' }),
    });
    expect(
      registry.resolveForDcr(['https://chatgpt.com/connector_platform_oauth_redirect']),
    ).toMatchObject({
      status: 'ok',
      client: expect.objectContaining({ key: 'fallback' }),
    });
  });

  it('rejects empty, invalid, or mixed-bucket DCR redirect URI sets', () => {
    const registry = createRegistry();

    expect(registry.resolveForDcr([])).toEqual({ status: 'empty' });
    expect(registry.resolveForDcr(['http://localhost:9999/callback'])).toEqual({
      status: 'invalid',
    });
    expect(
      registry.resolveForDcr([
        'http://localhost:8081/callback',
        'http://127.0.0.1:8082/callback',
      ]),
    ).toEqual({ status: 'mixed' });
  });

  it('fails startup when unknown has capabilities', () => {
    const invalidClients = TEST_CLIENTS.map((client) =>
      client.key === 'unknown'
        ? { ...client, capabilities: ['preferences:read'] as const }
        : client,
    ) as McpClientConfig[];

    expect(() => createRegistry(invalidClients)).toThrow(
      'Unknown MCP client bucket must not have capabilities',
    );
  });

  it('fails startup on duplicate redirect URI mappings', () => {
    const invalidClients = TEST_CLIENTS.map((client) =>
      client.key === 'codex'
        ? {
            ...client,
            oauth: {
              ...client.oauth!,
              redirectUris: ['http://localhost:8081/callback'],
            },
          }
        : client,
    );

    expect(() => createRegistry(invalidClients)).toThrow(
      'Duplicate MCP redirect URI mapping: http://localhost:8081/callback',
    );
  });
});
