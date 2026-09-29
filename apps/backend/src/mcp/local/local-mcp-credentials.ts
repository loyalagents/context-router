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
