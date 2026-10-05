import { BadRequestException, ConflictException } from '@nestjs/common';
import { SqliteMcpCredentials } from '../infrastructure/storage/sqlite/sqlite-mcp-credentials';
import { McpAuthorizationService } from '../mcp/auth/mcp-authorization.service';
import { LocalMcpAuthGuard } from '../mcp/local/local-mcp-auth.guard';
import { PermissionGrantService } from '../modules/permission-grant/permission-grant.service';
import type { LocalMcpAuthoritySnapshot } from '../mcp/local/local-mcp-credentials';

/** Browser administration reads one bounded SQLite snapshot, then uses MCP's evaluator. */
export class LocalUiManagement {
  constructor(
    private readonly credentials: SqliteMcpCredentials,
    private readonly principalId: string,
  ) {}
  private allowUnderMaximum(
    snapshot: Extract<LocalMcpAuthoritySnapshot, { status: 'AVAILABLE' }>,
    target: string,
    action: string,
  ): boolean {
    const authorization = new McpAuthorizationService(
      new PermissionGrantService({
        findMatchingGrants: async () => [],
        findByUserClientAction: async () => [],
      }),
    );
    const context = new LocalMcpAuthGuard(this.credentials).context({
      ...snapshot.client,
      principalId: this.principalId,
    });
    const grantClient = {
      ...context.client,
      policy: { ...context.client.policy, localTargets: [target] },
    };
    // For exact/prefix/universal patterns, their representatives include an intersection
    // whenever one exists. Both memberships and capability chains use the MCP evaluator.
    const candidates = [target, ...snapshot.client.policy.targets].map(
      (rule) =>
        rule === '*'
          ? '_authority_probe.value'
          : rule.endsWith('.*')
            ? `${rule.slice(0, -1)}_authority_probe`
            : rule,
    );
    const access = {
      resource: 'preferences' as const,
      action: action.toLowerCase() as 'read' | 'suggest' | 'write' | 'define',
    };
    if (!['READ', 'SUGGEST', 'WRITE', 'DEFINE'].includes(action)) return false;
    if (
      !target.includes('*') &&
      !snapshot.client.policy.allowSensitive &&
      snapshot.definitions.some(
        (definition) => definition.slug === target && definition.isSensitive,
      )
    )
      return false;
    return candidates.some(
      (slug) =>
        authorization.canAccess(context.client, access, context.grants, {
          slug,
        }) &&
        authorization.canAccess(grantClient, access, context.grants, { slug }),
    );
  }

  async handle(route: string, body: Record<string, unknown>): Promise<unknown> {
    const keys = Object.keys(body).sort().join(',');
    const id = body.id;
    const invalid = () => {
      throw new BadRequestException('Local MCP administration rejected');
    };
    if (route === '/api/local/mcp/list') {
      if (keys !== '' && (keys !== 'after' || typeof body.after !== 'string'))
        invalid();
      return this.credentials.listForUi(body.after as string | undefined);
    }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(id))
      return invalid();
    if (route === '/api/local/mcp/inspect') {
      if (keys !== 'id' && keys !== 'id,targets') invalid();
      const targets = body.targets === undefined ? [] : body.targets;
      const snapshot = this.credentials.inspectForUi(id, targets as string[]);
      if (snapshot.status !== 'AVAILABLE') return snapshot;
      const grants = new PermissionGrantService({
        findMatchingGrants: async (_user, _client, action, prefixes) =>
          snapshot.grants.filter(
            (grant) =>
              grant.action === action && prefixes.includes(grant.target),
          ),
        findByUserClientAction: async (_user, _client, action) =>
          snapshot.grants.filter((grant) => grant.action === action),
      });
      const authorization = new McpAuthorizationService(grants, {
        getAll: async () => snapshot.definitions,
        getDefinitionById: async () => null, // No value/archived-definition claims are made by this projection.
      });
      const context = new LocalMcpAuthGuard(this.credentials).context({
        ...snapshot.client,
        principalId: this.principalId,
      });
      const effective = await Promise.all(
        (targets as string[]).map(async (target) => {
          const allowed = async (
            action: 'read' | 'suggest' | 'write' | 'define',
          ) =>
            !snapshot.client.revoked &&
            authorization.canAccessTarget(
              context.client,
              { resource: 'preferences', action },
              context.grants,
              this.principalId,
              { slug: target },
            );
          return {
            target,
            knownDefinition: snapshot.definitions.some(
              (definition) => definition.slug === target,
            ),
            sensitive: snapshot.definitions.some(
              (definition) =>
                definition.slug === target && definition.isSensitive,
            ),
            read: await allowed('read'),
            suggest: await allowed('suggest'),
            write: await allowed('write'),
            define: await allowed('define'),
          };
        }),
      );
      const result = { ...snapshot, effective };
      return Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024
        ? result
        : { status: 'AUTHORITY_UNAVAILABLE', client: snapshot.client };
    }
    if (!Number.isSafeInteger(body.generation) || Number(body.generation) < 1)
      invalid();
    try {
      if (route === '/api/local/mcp/revoke' && keys === 'generation,id') {
        return {
          client: this.credentials.revoke(id, body.generation as number),
        };
      }
      if (
        route === '/api/local/mcp/grant' &&
        keys === 'action,effect,generation,id,revision,target'
      ) {
        if (
          typeof body.revision !== 'string' ||
          !/^[a-f0-9]{64}$/.test(body.revision) ||
          typeof body.target !== 'string' ||
          typeof body.action !== 'string' ||
          typeof body.effect !== 'string'
        )
          return invalid();
        const target = body.target,
          action = body.action;
        this.credentials.grant(
          id,
          target,
          action,
          body.effect,
          { generation: body.generation as number, revision: body.revision },
          (snapshot) => this.allowUnderMaximum(snapshot, target, action),
        );
        return { changed: true };
      }
      return invalid();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Local MCP ALLOW exceeds maximum'
      )
        return { changed: false, reason: 'OUTSIDE_MAXIMUM' };
      if (
        error instanceof Error &&
        error.message === 'Local MCP administration conflict'
      )
        throw new ConflictException(
          'Authority changed. Reload before editing.',
        );
      throw error;
    }
  }
}
