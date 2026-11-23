import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { LocalMcpPolicy, LocalMcpGrantEdit, LocalMcpGrantSnapshot } from '../mcp/local/local-mcp-credentials';

export type PermissionChange = {
  kind: 'maximum' | 'scope' | 'sensitive' | 'rule' | 'connection';
  target?: string; action?: string; before: string; after: string;
};
export type PermissionActivity = {
  id: string; sequence: number; occurredAt: string; clientKey: string;
  actor: 'dashboard-user'; action: 'save' | 'grant' | 'revoke';
  changes: PermissionChange[]; omittedChanges: number;
};

/** Temporary presentation evidence only. Never participates in authorization. */
export class SessionPermissionActivity {
  private readonly sessionId = randomBytes(16).toString('hex');
  private sequence = 0;
  private lastEvictedSequence = 0;
  private items: PermissionActivity[] = [];
  record(clientId: string, action: PermissionActivity['action'], changes: PermissionChange[]): string | null {
    if (!changes.length) return null;
    const event: PermissionActivity = {
      id: randomBytes(16).toString('hex'), sequence: this.sequence + 1,
      occurredAt: new Date().toISOString(), clientKey: `local:${clientId}`,
      actor: 'dashboard-user', action, changes: changes.slice(0, 24),
      omittedChanges: Math.max(0, changes.length - 24),
    };
    while (Buffer.byteLength(JSON.stringify(event)) > 8192 && event.changes.length) {
      event.changes.pop(); event.omittedChanges++;
    }
    this.items.unshift(event); this.sequence = event.sequence;
    if (this.items.length > 50) { this.lastEvictedSequence = this.items.pop()!.sequence; }
    return event.id;
  }
  read() {
    return structuredClone({ sessionId: this.sessionId, latestSequence: this.sequence, limit: 50, truncated: this.lastEvictedSequence > 0, items: this.items });
  }
  clear(sessionId: unknown, throughSequence: unknown) {
    if (typeof sessionId !== 'string' || !/^[a-f0-9]{32}$/.test(sessionId) || !Number.isSafeInteger(throughSequence) || Number(throughSequence) < 0)
      throw new BadRequestException('Invalid session activity clear');
    if (sessionId !== this.sessionId) throw new ConflictException('The app session changed. Refresh before clearing.');
    if (Number(throughSequence) > this.sequence) throw new BadRequestException('Invalid session activity cutoff');
    this.items = this.items.filter(event => event.sequence > Number(throughSequence));
    if (Number(throughSequence) >= this.lastEvictedSequence) this.lastEvictedSequence = 0;
    return { cleared: true };
  }
}

export function permissionChanges(before: LocalMcpPolicy, after: LocalMcpPolicy, grants: LocalMcpGrantSnapshot[], edits: LocalMcpGrantEdit[]): PermissionChange[] {
  const changes: PermissionChange[] = [];
  const capabilities = (policy: LocalMcpPolicy) => {
    // Compare the minimal equivalent maximum; DEFINE is independent of value access.
    const values = new Set(policy.capabilities);
    if (values.has('preferences:write')) values.delete('preferences:suggest');
    if (values.has('preferences:write') || values.has('preferences:suggest')) values.delete('preferences:read');
    return [...values].sort().join(', ') || 'None';
  };
  if (capabilities(before) !== capabilities(after)) changes.push({kind:'maximum', before:capabilities(before), after:capabilities(after)});
  for (const target of [...new Set([...before.targets, ...after.targets])].sort()) {
    const was = before.targets.includes(target), now = after.targets.includes(target);
    if (was !== now) changes.push({kind:'scope', target, before:was?'Included':'Not included', after:now?'Included':'Removed'});
  }
  if (before.allowSensitive !== after.allowSensitive) changes.push({kind:'sensitive', before:before.allowSensitive?'Allowed':'Blocked', after:after.allowSensitive?'Allowed':'Blocked'});
  for (const edit of edits) {
    const old = grants.find(grant => grant.target === edit.target && grant.action === edit.action)?.effect ?? 'No rule';
    const next = edit.effect === 'REMOVE' ? 'No rule' : edit.effect;
    if (old !== next) changes.push({kind:'rule', target:edit.target, action:edit.action, before:old, after:next});
  }
  return changes;
}
