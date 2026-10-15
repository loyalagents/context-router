import {
  isMcpCapability,
  type McpCapability,
} from '../types/mcp-authorization.types';

export interface LocalMcpPolicy {
  capabilities: McpCapability[];
  targets: string[];
  allowSensitive: boolean;
}
export interface LocalMcpClientSummary {
  id: string;
  label: string;
  generation: number;
  revoked: boolean;
  policy: LocalMcpPolicy;
}
export interface LocalMcpCredential extends LocalMcpClientSummary {
  principalId: string;
}
export interface LocalMcpGrantSnapshot {
  id: string; target: string; action: 'READ' | 'SUGGEST' | 'WRITE' | 'DEFINE'; effect: 'ALLOW' | 'DENY';
  createdAt: number; updatedAt: number;
}
export type LocalMcpAuthoritySnapshot = { status: 'AUTHORITY_UNAVAILABLE'; client: LocalMcpClientSummary; adminRevision: string } | {
  status: 'AVAILABLE'; adminRevision: string; client: LocalMcpClientSummary; grants: LocalMcpGrantSnapshot[]; revision: string;
  definitions: { slug: string; isSensitive: boolean }[];
};
export interface LocalMcpExpectedAuthority { generation: number; revision: string; }
/** Local edge port: implementations must return fresh persisted authority. */
export abstract class LocalMcpCredentials {
  abstract authenticate(token: string): LocalMcpCredential | null;
}
export const validLocalMcpTarget = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 128 &&
  (value === '*' || /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*(?:\.\*)?$/.test(value));

export function validateLocalMcpPolicy(value: unknown): LocalMcpPolicy {
  const policy = value as LocalMcpPolicy;
  if (
    !policy ||
    typeof policy !== 'object' ||
    Array.isArray(policy) ||
    Object.keys(policy).sort().join() !==
      'allowSensitive,capabilities,targets' ||
    !Array.isArray(policy.capabilities) ||
    policy.capabilities.length > 4 ||
    policy.capabilities.some((capability) => !isMcpCapability(capability)) ||
    new Set(policy.capabilities).size !== policy.capabilities.length ||
    !Array.isArray(policy.targets) ||
    policy.targets.length > 64 ||
    policy.targets.some((target) => !validLocalMcpTarget(target)) ||
    new Set(policy.targets).size !== policy.targets.length ||
    typeof policy.allowSensitive !== 'boolean'
  ) {
    throw new Error('Invalid local MCP policy');
  }
  return {
    capabilities: [...policy.capabilities],
    targets: [...policy.targets],
    allowSensitive: policy.allowSensitive,
  };
}

export interface LocalMcpGrantEdit {
  target: string;
  action: 'READ' | 'SUGGEST' | 'WRITE' | 'DEFINE';
  effect: 'ALLOW' | 'DENY' | 'REMOVE';
}
export interface LocalMcpCatalogDefinition {
  id: string;
  namespace: string;
  ownerUserId: string | null;
  slug: string;
  displayName: string | null;
  displayNameTruncated: boolean;
  isSensitive: boolean;
  archivedAt: number | null;
}
export type LocalMcpEditorSnapshot = LocalMcpAuthoritySnapshot &
  (
    | { catalogStatus: 'CATALOG_UNAVAILABLE' }
    | {
        catalogStatus: 'AVAILABLE';
        catalogRevision: string;
        catalog: LocalMcpCatalogDefinition[];
      }
  );
export function validateLocalMcpGrantEdits(
  value: unknown,
): LocalMcpGrantEdit[] {
  if (!Array.isArray(value) || value.length > 512)
    throw new Error('Invalid local MCP grant edits');
  const keys = new Set<string>();
  return value.map((edit) => {
    if (
      !edit ||
      typeof edit !== 'object' ||
      Array.isArray(edit) ||
      Object.keys(edit).sort().join() !== 'action,effect,target' ||
      !validLocalMcpTarget(edit.target) ||
      !['READ', 'SUGGEST', 'WRITE', 'DEFINE'].includes(edit.action) ||
      !['ALLOW', 'DENY', 'REMOVE'].includes(edit.effect)
    )
      throw new Error('Invalid local MCP grant edits');
    const key = edit.target + ':' + edit.action;
    if (keys.has(key)) throw new Error('Invalid local MCP grant edits');
    keys.add(key);
    return { target: edit.target, action: edit.action, effect: edit.effect };
  });
}
