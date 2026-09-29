import type { IncomingMessage } from 'node:http';
import {
  LocalMcpCredentials,
  type LocalMcpCredential,
} from './local-mcp-credentials';
import type { McpContext } from '../types/mcp-context.type';

export class LocalMcpHttpError extends Error {
  constructor(readonly status: number) {
    super('Local MCP request rejected');
  }
}
export class LocalMcpAuthGuard {
  constructor(private readonly credentials: LocalMcpCredentials) {}
  authenticate(request: IncomingMessage, port: number): LocalMcpCredential {
    const counts = new Map<string, number>();
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const key = request.rawHeaders[i].toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const key of [
      'host',
      'authorization',
      'origin',
      'mcp-session-id',
      'mcp-protocol-version',
      'content-type',
      'content-length',
    ])
      if ((counts.get(key) ?? 0) > 1) throw new LocalMcpHttpError(400);
    if (request.headers.host !== `127.0.0.1:${port}` || counts.has('origin'))
      throw new LocalMcpHttpError(403);
    const header = request.headers.authorization;
    if (
      typeof header !== 'string' ||
      !/^Bearer cr_mcp_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(header)
    )
      throw new LocalMcpHttpError(401);
    const credential = this.credentials.authenticate(header.slice(7));
    if (!credential) throw new LocalMcpHttpError(401);
    return credential;
  }
  context(credential: LocalMcpCredential): McpContext {
    const key = `local:${credential.id}` as const;
    return {
      user: {
        userId: credential.principalId,
        email: 'local@principal.invalid',
      },
      grants: [...credential.policy.capabilities],
      client: {
        key,
        policy: {
          key,
          label: credential.label,
          capabilities: [...credential.policy.capabilities],
          targetRules: [],
          localTargets: [...credential.policy.targets],
          allowSensitive: credential.policy.allowSensitive,
        },
      },
    };
  }
}
