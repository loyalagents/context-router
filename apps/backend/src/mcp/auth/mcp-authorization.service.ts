import { Injectable, Logger } from '@nestjs/common';
import { PermissionGrantService } from '@modules/permission-grant/permission-grant.service';
import {
  McpAccess,
  McpCapability,
  McpTarget,
  McpTargetRule,
  ResolvedMcpClient,
} from '../types/mcp-authorization.types';

const VALUE_ACCESS_CHAIN: Record<McpAccess['action'], McpAccess['action'][]> = {
  read: ['read'],
  suggest: ['read', 'suggest'],
  write: ['read', 'suggest', 'write'],
  define: ['define'],
};

export class McpAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly clientKey: string,
    public readonly capability: McpCapability,
    public readonly surface: string,
  ) {
    super(message);
  }
}

@Injectable()
export class McpAuthorizationService {
  private readonly logger = new Logger(McpAuthorizationService.name);

  constructor(
    private readonly permissionGrantService: PermissionGrantService,
  ) {}

  toCapability(access: McpAccess): McpCapability {
    if (access.resource === 'preferences' && access.action === 'read') {
      return 'preferences:read';
    }

    if (access.resource === 'preferences' && access.action === 'suggest') {
      return 'preferences:suggest';
    }

    if (access.resource === 'preferences' && access.action === 'write') {
      return 'preferences:write';
    }

    if (access.resource === 'preferences' && access.action === 'define') {
      return 'preferences:define';
    }

    throw new Error(
      `Unsupported MCP access declaration: ${JSON.stringify(access)}`,
    );
  }

  normalizeAccessList(access: McpAccess | readonly McpAccess[]): McpAccess[] {
    return Array.isArray(access) ? [...access] : [access as McpAccess];
  }

  getEffectiveCapabilities(
    client: ResolvedMcpClient,
    grants?: McpCapability[],
  ): McpCapability[] {
    const policyCaps = this.expandCapabilities(client.policy.capabilities);
    if (!grants) {
      return [...policyCaps];
    }

    const grantCaps = this.expandCapabilities(grants);
    return [...policyCaps].filter((capability) => grantCaps.has(capability));
  }

  canAccess(
    client: ResolvedMcpClient,
    access: McpAccess,
    grants?: McpCapability[],
    target?: McpTarget,
  ): boolean {
    const capability = this.toCapability(access);
    const effectiveCapabilities = this.getEffectiveCapabilities(client, grants);

    if (!effectiveCapabilities.includes(capability)) {
      return false;
    }

    if (!target) {
      return true;
    }

    for (const action of this.getActionChain(access.action)) {
      const chainedAccess: McpAccess = {
        resource: access.resource,
        action,
      };
      const chainedCapability = this.toCapability(chainedAccess);

      if (!effectiveCapabilities.includes(chainedCapability)) {
        return false;
      }

      if (!this.canAccessTargetRule(client, chainedCapability, target)) {
        return false;
      }
    }

    return true;
  }

  canAccessAny(
    client: ResolvedMcpClient,
    access: McpAccess | readonly McpAccess[],
    grants?: McpCapability[],
    target?: McpTarget,
  ): boolean {
    return this.normalizeAccessList(access).some((entry) =>
      this.canAccess(client, entry, grants, target),
    );
  }

  private canAccessTargetRule(
    client: ResolvedMcpClient,
    capability: McpCapability,
    target: McpTarget,
  ): boolean {
    const relevantRules = client.policy.targetRules.filter(
      (rule) => rule.capability === capability,
    );

    if (relevantRules.length === 0) {
      return true;
    }

    const matchingDenies = relevantRules.filter(
      (rule) => rule.effect === 'deny' && this.matchesTarget(rule, target),
    );
    if (matchingDenies.length > 0) {
      return false;
    }

    const matchingAllows = relevantRules.filter(
      (rule) => rule.effect === 'allow' && this.matchesTarget(rule, target),
    );

    return matchingAllows.length > 0;
  }

  assertAccess(
    client: ResolvedMcpClient,
    access: McpAccess,
    grants: McpCapability[] | undefined,
    surface: string,
    target?: McpTarget,
  ): void {
    if (this.canAccess(client, access, grants, target)) {
      return;
    }

    const capability = this.toCapability(access);
    this.logger.warn(
      JSON.stringify({
        decision: 'deny',
        clientKey: client.key,
        surface,
        resource: access.resource,
        action: access.action,
        capability,
      }),
    );

    throw new McpAuthorizationError(
      `Client "${client.key}" is not allowed to ${access.action} ${access.resource}`,
      client.key,
      capability,
      surface,
    );
  }

  async canAccessTarget(
    client: ResolvedMcpClient,
    access: McpAccess,
    grants: McpCapability[] | undefined,
    userId: string,
    target: McpTarget,
  ): Promise<boolean> {
    if (!this.canAccess(client, access, grants, target)) {
      return false;
    }

    if (!target.slug) {
      return true;
    }

    for (const action of this.getActionChain(access.action)) {
      const decision = await this.permissionGrantService.evaluateAccess(
        userId,
        client.key,
        action,
        target.slug,
      );

      if (decision === 'deny') {
        return false;
      }
    }

    return true;
  }

  async assertAccessTarget(
    client: ResolvedMcpClient,
    access: McpAccess,
    grants: McpCapability[] | undefined,
    userId: string,
    surface: string,
    target: McpTarget,
  ): Promise<void> {
    if (await this.canAccessTarget(client, access, grants, userId, target)) {
      return;
    }

    const capability = this.toCapability(access);
    this.logger.warn(
      JSON.stringify({
        decision: 'deny',
        clientKey: client.key,
        surface,
        resource: access.resource,
        action: access.action,
        capability,
        target,
      }),
    );

    throw new McpAuthorizationError(
      `Client "${client.key}" is not allowed to ${access.action} ${access.resource}`,
      client.key,
      capability,
      surface,
    );
  }

  async filterByTargetAccess(
    client: ResolvedMcpClient,
    access: McpAccess,
    grants: McpCapability[] | undefined,
    userId: string,
    slugs: string[],
  ): Promise<string[]> {
    const coarseAllowedSlugs = slugs.filter((slug) =>
      this.canAccess(client, access, grants, { slug }),
    );

    if (coarseAllowedSlugs.length === 0) {
      return [];
    }

    let allowedSlugs = coarseAllowedSlugs;
    for (const action of this.getActionChain(access.action)) {
      allowedSlugs = await this.permissionGrantService.filterSlugsByAccess(
        userId,
        client.key,
        action,
        allowedSlugs,
      );
    }

    return allowedSlugs;
  }

  private expandCapabilities(
    capabilities: readonly McpCapability[],
  ): Set<McpCapability> {
    const expanded = new Set<McpCapability>();

    for (const capability of capabilities) {
      expanded.add(capability);
      if (capability === 'preferences:suggest') {
        expanded.add('preferences:read');
      }
      if (capability === 'preferences:write') {
        expanded.add('preferences:read');
        expanded.add('preferences:suggest');
      }
    }

    return expanded;
  }

  private getActionChain(action: McpAccess['action']): McpAccess['action'][] {
    return VALUE_ACCESS_CHAIN[action];
  }

  private matchesTarget(rule: McpTargetRule, target: McpTarget): boolean {
    const { namespace, slug, slugPrefix } = rule.matcher;

    if (namespace && target.namespace !== namespace) {
      return false;
    }

    if (slug && target.slug !== slug) {
      return false;
    }

    if (slugPrefix && (!target.slug || !target.slug.startsWith(slugPrefix))) {
      return false;
    }

    return true;
  }
}
