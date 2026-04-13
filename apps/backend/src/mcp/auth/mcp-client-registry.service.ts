import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  McpClientConfig,
  McpClientKey,
  ResolvedMcpClient,
} from '../types/mcp-authorization.types';

type DcrResolution =
  | { status: 'ok'; client: McpClientConfig }
  | { status: 'invalid' }
  | { status: 'mixed' }
  | { status: 'empty' };

@Injectable()
export class McpClientRegistry implements OnModuleInit {
  private readonly logger = new Logger(McpClientRegistry.name);
  private readonly clientsByKey = new Map<McpClientKey, McpClientConfig>();
  private readonly clientKeyByExternalId = new Map<string, McpClientKey>();
  private readonly clientKeyByRedirectUri = new Map<string, McpClientKey>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const clients = this.getConfiguredClients();

    for (const client of clients) {
      if (this.clientsByKey.has(client.key)) {
        throw new Error(`Duplicate MCP client key: ${client.key}`);
      }
      this.clientsByKey.set(client.key, client);
    }

    const unknown = this.clientsByKey.get('unknown');
    if (!unknown) {
      throw new Error('MCP client config missing required "unknown" bucket');
    }
    if (unknown.capabilities.length > 0) {
      throw new Error('Unknown MCP client bucket must not have capabilities');
    }

    for (const client of clients) {
      this.validateTargetRules(client);

      if (client.oauth?.clientId) {
        if (this.clientKeyByExternalId.has(client.oauth.clientId)) {
          throw new Error(
            `Duplicate MCP OAuth client ID mapping: ${client.oauth.clientId}`,
          );
        }
        this.clientKeyByExternalId.set(client.oauth.clientId, client.key);
      }

      for (const redirectUri of client.oauth?.redirectUris ?? []) {
        if (this.clientKeyByRedirectUri.has(redirectUri)) {
          throw new Error(
            `Duplicate MCP redirect URI mapping: ${redirectUri}`,
          );
        }
        this.clientKeyByRedirectUri.set(redirectUri, client.key);
      }
    }

    for (const client of clients) {
      if (!client.oauth?.clientId) {
        continue;
      }

      const resolved = this.resolveFromTokenPayload({ azp: client.oauth.clientId });
      if (resolved.key !== client.key) {
        throw new Error(
          `MCP client "${client.key}" does not round-trip through token resolution`,
        );
      }
    }
  }

  getPolicy(key: McpClientKey) {
    const client = this.clientsByKey.get(key);
    if (!client) {
      throw new Error(`Unknown MCP client key: ${key}`);
    }
    return client;
  }

  resolveFromClientKey(key: McpClientKey): ResolvedMcpClient {
    this.logger.debug(
      JSON.stringify({
        decision: 'resolve_client',
        clientKey: key,
        reason: 'direct_client_key',
      }),
    );
    return this.resolveByKey(key);
  }

  resolveFromTokenPayload(payload: Record<string, unknown> | undefined): ResolvedMcpClient {
    const externalId = this.extractExternalId(payload);
    if (!externalId) {
      this.logger.warn(
        JSON.stringify({
          decision: 'resolve_client',
          clientKey: 'unknown',
          reason: 'missing_external_id',
        }),
      );
      return this.resolveByKey('unknown');
    }

    const clientKey = this.clientKeyByExternalId.get(externalId);
    if (!clientKey) {
      this.logger.warn(
        JSON.stringify({
          decision: 'resolve_client',
          clientKey: 'unknown',
          externalId,
          reason: 'unmapped_external_id',
        }),
      );
      return this.resolveByKey('unknown', externalId);
    }

    this.logger.debug(
      JSON.stringify({
        decision: 'resolve_client',
        clientKey,
        externalId,
      }),
    );
    return this.resolveByKey(clientKey, externalId);
  }

  resolveForDcr(redirectUris: string[]): DcrResolution {
    if (redirectUris.length === 0) {
      return { status: 'empty' };
    }

    let bucketKey: McpClientKey | undefined;
    for (const redirectUri of redirectUris) {
      const key = this.clientKeyByRedirectUri.get(redirectUri);
      if (!key) {
        return { status: 'invalid' };
      }

      if (!bucketKey) {
        bucketKey = key;
        continue;
      }

      if (bucketKey !== key) {
        return { status: 'mixed' };
      }
    }

    const client = this.getPolicy(bucketKey!);
    if (!client.oauth?.clientId) {
      return { status: 'invalid' };
    }

    this.logger.debug(
      JSON.stringify({
        decision: 'resolve_dcr_client',
        clientKey: client.key,
      }),
    );
    return { status: 'ok', client };
  }

  private resolveByKey(
    key: McpClientKey,
    externalId?: string,
  ): ResolvedMcpClient {
    const policy = this.getPolicy(key);
    return {
      key,
      externalId,
      policy: {
        key: policy.key,
        label: policy.label,
        capabilities: [...policy.capabilities],
        targetRules: [...policy.targetRules],
      },
    };
  }

  private getConfiguredClients(): McpClientConfig[] {
    return this.configService.get<McpClientConfig[]>('mcp.clients', []);
  }

  private extractExternalId(
    payload: Record<string, unknown> | undefined,
  ): string | undefined {
    if (!payload) {
      return undefined;
    }

    const candidates = [payload.azp, payload.client_id, payload.clientId];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }

    if (typeof payload.sub === 'string' && payload.sub.endsWith('@clients')) {
      return payload.sub.replace(/@clients$/, '');
    }

    return undefined;
  }

  private validateTargetRules(client: McpClientConfig) {
    for (const rule of client.targetRules) {
      if (rule.matcher.namespace) {
        throw new Error(
          `MCP client "${client.key}" has a target rule with unsupported namespace matching`,
        );
      }

      const matcherKeys = [
        rule.matcher.namespace,
        rule.matcher.slug,
        rule.matcher.slugPrefix,
      ].filter(Boolean);

      if (matcherKeys.length === 0) {
        throw new Error(
          `MCP client "${client.key}" has a target rule without matcher fields`,
        );
      }

      if (rule.matcher.slug && rule.matcher.slugPrefix) {
        throw new Error(
          `MCP client "${client.key}" has a target rule with both slug and slugPrefix`,
        );
      }
    }
  }
}
