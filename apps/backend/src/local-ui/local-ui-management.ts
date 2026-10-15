import { BadRequestException, ConflictException } from '@nestjs/common';
import { SqliteMcpCredentials } from '../infrastructure/storage/sqlite/sqlite-mcp-credentials';
import { McpAuthorizationService } from '../mcp/auth/mcp-authorization.service';
import { LocalMcpAuthGuard } from '../mcp/local/local-mcp-auth.guard';
import { PermissionGrantService } from '../modules/permission-grant/permission-grant.service';
import { validateLocalMcpPolicy, validateLocalMcpGrantEdits, type LocalMcpAuthoritySnapshot } from '../mcp/local/local-mcp-credentials';
import { requireEditable, summarizePermissions, previewPermissions } from './local-ui-mcp-permissions';

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

  async handle(route: string, body: Record<string, unknown>, revalidate: () => void = () => {}): Promise<unknown> {
    const keys = Object.keys(body).sort().join(',');
    const id = body.id;
    const invalid = () => {
      throw new BadRequestException('Local MCP administration rejected');
    };
    if (route === '/api/local/mcp/list') {
      if (keys !== '' && (keys !== 'after' || typeof body.after !== 'string'))
        invalid();
      const page = this.credentials.listForUi(body.after as string | undefined);
      const items = [];
      for (const client of page.items) {
        const snapshot = this.credentials.editorSnapshot(client.id);
        items.push({ ...snapshot.client, ruleCount: snapshot.status === 'AVAILABLE' ? snapshot.grants.length : null,
          summary: snapshot.status === 'AVAILABLE' && snapshot.catalogStatus === 'AVAILABLE' ? await summarizePermissions(snapshot, this.credentials, this.principalId) : null });
      }
      return { ...page, items };
    }
    if (route === '/api/local/mcp/labels') {
      if (keys !== 'ids') return invalid();
      return this.credentials.labelsForUi(body.ids as string[]);
    }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(id))
      return invalid();
    if (route === '/api/local/mcp/inspect') {
      if (keys !== 'id' && keys !== 'id,targets') invalid();
      const targets = body.targets === undefined ? [] : body.targets;
      const editor = this.credentials.editorSnapshot(id, targets as string[]);
      const { catalog: _catalog, ...snapshot } = { catalog: undefined, ...editor };
      const summary = editor.status === 'AVAILABLE' && editor.catalogStatus === 'AVAILABLE' ? await summarizePermissions(editor, this.credentials, this.principalId) : undefined;
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
      const result = { ...snapshot, effective, summary };
      return Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024
        ? result
        : { status: 'AUTHORITY_UNAVAILABLE', client: snapshot.client, adminRevision: snapshot.adminRevision };
    }
    if (route === '/api/local/mcp/targets') {
      if (
        keys !== 'id,query' ||
        typeof body.query !== 'string' ||
        body.query.length > 128
      )
        return invalid();
      const snapshot = this.credentials.editorSnapshot(id);
      requireEditable(snapshot);
      const query = body.query.toLowerCase();
      const categories = new Set<string>();
      for (const field of snapshot.catalog.filter(
        (row) => row.archivedAt === null,
      )) {
        const parts = field.slug.split('.');
        for (let i = 1; i < parts.length; i++)
          categories.add(parts.slice(0, i).join('.') + '.*');
      }
      const items = [
        {
          kind: 'category',
          target: '*',
          name: 'All fields (including future fields)',
        },
        ...[...categories]
          .sort()
          .map((target) => ({
            kind: 'category',
            target,
            name:
              target.slice(0, -2).replace(/[._]/g, ' ') + ' — prefix ' + target,
          })),
        ...snapshot.catalog
          .filter((row) => row.archivedAt === null)
          .map((row) => ({
            kind: 'field',
            target: row.slug,
            name: row.displayName ?? row.slug,
            namespace: row.namespace,
            sensitive: row.isSensitive,
          })),
      ].filter((item) =>
        (item.target + ' ' + item.name).toLowerCase().includes(query),
      );
      return {
        revision: snapshot.revision,
        catalogRevision: snapshot.catalogRevision,
        items: items.slice(0, 32),
        hasMore: items.length > 32,
      };
    }
    if (route === '/api/local/mcp/preview' || route === '/api/local/mcp/save') {
      const saving = route.endsWith('/save');
      if (
        keys !==
          (saving
            ? 'catalogRevision,edits,generation,id,policy,previewKey,revision'
            : 'catalogRevision,edits,generation,id,policy,revision') ||
        !Number.isSafeInteger(body.generation) ||
        Number(body.generation) < 1 ||
        typeof body.revision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.revision) ||
        typeof body.catalogRevision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.catalogRevision) ||
        (saving &&
          (typeof body.previewKey !== 'string' ||
            !/^[a-f0-9]{64}$/.test(body.previewKey)))
      )
        return invalid();
      const policy = validateLocalMcpPolicy(body.policy),
        edits = validateLocalMcpGrantEdits(body.edits);
      const snapshot = this.credentials.editorSnapshot(id);
      requireEditable(snapshot);
      if (
        snapshot.revision !== body.revision ||
        snapshot.client.generation !== body.generation ||
        snapshot.catalogRevision !== body.catalogRevision
      )
        throw new ConflictException('Authority changed. Reload before editing.');
      const proposed = {
        ...snapshot,
        client: { ...snapshot.client, policy },
        definitions: snapshot.catalog.filter((row) => row.archivedAt === null),
      };
      for (const edit of edits) {
        const unchanged = snapshot.grants.some(
          (grant) =>
            grant.target === edit.target &&
            grant.action === edit.action &&
            grant.effect === edit.effect,
        );
        if (
          edit.effect === 'ALLOW' &&
          !unchanged &&
          !this.allowUnderMaximum(proposed, edit.target, edit.action)
        )
          throw new BadRequestException('ALLOW exceeds proposed maximum');
      }
      const preview = await previewPermissions(
        snapshot,
        policy,
        edits,
        this.credentials,
        this.principalId,
      );
      if (!saving) return preview;
      if (body.previewKey !== preview.previewKey)
        throw new ConflictException(
          'Preview changed. Preview again before saving.',
        );
      try {
        const result = this.credentials.savePermissions(
          id,
          policy,
          edits,
          {
            generation: body.generation as number,
            revision: body.revision,
            catalogRevision: body.catalogRevision,
          },
          revalidate,
        );
        return { changed: true, ...result };
      } catch (error) {
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
    if (!Number.isSafeInteger(body.generation) || Number(body.generation) < 1)
      invalid();
    try {
      if (route === '/api/local/mcp/rename' && keys === 'expectedLabel,generation,id,label') {
        return { client: this.credentials.rename(id, body.label as string, {
          label: body.expectedLabel as string, generation: body.generation as number,
        }) };
      }
      if (route === '/api/local/mcp/revoke' && (keys === 'generation,id' || keys === 'generation,id,revision')) {
        if (body.revision !== undefined && (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision))) return invalid();
        return {
          client: this.credentials.revoke(id, body.generation as number, body.revision as string | undefined),
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
