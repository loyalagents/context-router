import { Injectable, Logger } from '@nestjs/common';
import { PermissionGrantService } from '@modules/permission-grant/permission-grant.service';
import {
  McpAccess,
  McpCapability,
  McpTarget,
  McpTargetRule,
  ResolvedMcpClient,
} from '../types/mcp-authorization.types';

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

    if (access.resource === 'preferences' && access.action === 'write') {
      return 'preferences:write';
    }

    throw new Error(
      `Unsupported MCP access declaration: ${JSON.stringify(access)}`,
    );
  }

  getEffectiveCapabilities(
    client: ResolvedMcpClient,
    grants?: McpCapability[],
  ): McpCapability[] {
    const policyCaps = new Set(client.policy.capabilities);
    if (!grants) {
      return [...policyCaps];
    }

    return [...policyCaps].filter((capability) => grants.includes(capability));
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

    const decision = await this.permissionGrantService.evaluateAccess(
      userId,
      client.key,
      access.action,
      target.slug,
    );

    return decision !== 'deny';
  }

  async assertAccessTarget(
    client: ResolvedMcpClient,
    access: McpAccess,
    grants: McpCapability[] | undefined,
    userId: string,
    surface: string,
    target: McpTarget,
  ): Promise<void> {
    if (
      await this.canAccessTarget(client, access, grants, userId, target)
    ) {
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

    return this.permissionGrantService.filterSlugsByAccess(
      userId,
      client.key,
      access.action,
      coarseAllowedSlugs,
    );
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
