import { BadRequestException, Injectable } from '@nestjs/common';
import { GrantAction, GrantEffect } from '@infrastructure/prisma/generated-client';
import { PermissionGrantRepository } from './permission-grant.repository';

export type PermissionGrantDecision = 'allow' | 'deny' | 'no-grant';
type PermissionGrantActionInput = GrantAction | 'read' | 'write';
export const PERMISSION_GRANT_TARGET_PATTERN =
  /^\*$|^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*(?:\.\*)$|^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

@Injectable()
export class PermissionGrantService {
  constructor(private readonly repository: PermissionGrantRepository) {}

  buildPrefixChain(slug: string): string[] {
    const segments = slug.split('.');
    const chain = [slug];

    for (let i = segments.length - 1; i >= 1; i -= 1) {
      chain.push(`${segments.slice(0, i).join('.')}.*`);
    }

    chain.push('*');
    return chain;
  }

  async evaluateAccess(
    userId: string,
    clientKey: string,
    action: PermissionGrantActionInput,
    slug: string,
  ): Promise<PermissionGrantDecision> {
    const grants = await this.repository.findMatchingGrants(
      userId,
      clientKey,
      this.normalizeAction(action),
      this.buildPrefixChain(slug),
    );

    return this.evaluateAgainstGrants(grants, slug);
  }

  async filterSlugsByAccess(
    userId: string,
    clientKey: string,
    action: PermissionGrantActionInput,
    slugs: string[],
  ): Promise<string[]> {
    const grants = await this.repository.findByUserClientAction(
      userId,
      clientKey,
      this.normalizeAction(action),
    );

    return slugs.filter(
      (slug) => this.evaluateAgainstGrants(grants, slug) !== 'deny',
    );
  }

  private evaluateAgainstGrants(
    grants: Array<{ target: string; effect: GrantEffect }>,
    slug: string,
  ): PermissionGrantDecision {
    if (grants.length === 0) {
      return 'no-grant';
    }

    const prefixChain = new Set(this.buildPrefixChain(slug));
    const matches = grants.filter((grant) => prefixChain.has(grant.target));

    if (matches.length === 0) {
      return 'no-grant';
    }

    const highestSpecificity = Math.max(
      ...matches.map((grant) => grant.target.length),
    );
    const mostSpecificMatches = matches.filter(
      (grant) => grant.target.length === highestSpecificity,
    );

    if (mostSpecificMatches.some((grant) => grant.effect === 'DENY')) {
      return 'deny';
    }

    return 'allow';
  }

  private normalizeAction(action: PermissionGrantActionInput): GrantAction {
    return action.toUpperCase() as GrantAction;
  }

  assertValidTarget(target: string): void {
    if (PERMISSION_GRANT_TARGET_PATTERN.test(target)) {
      return;
    }

    throw new BadRequestException(
      `Invalid permission grant target: "${target}". Expected "*", "<category>.*", "<nested.prefix>.*", or an exact slug.`,
    );
  }
}
