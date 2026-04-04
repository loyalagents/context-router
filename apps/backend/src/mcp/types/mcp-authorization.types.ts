export type McpClientKey = 'claude' | 'codex' | 'fallback' | 'unknown';

export interface McpAccess {
  resource: 'preferences';
  action: 'read' | 'write';
}

export const MCP_CAPABILITIES = [
  'preferences:read',
  'preferences:write',
] as const;

export type McpCapability = (typeof MCP_CAPABILITIES)[number];

export interface McpTarget {
  namespace?: string;
  slug?: string;
}

export interface McpTargetRuleMatcher {
  namespace?: string;
  slug?: string;
  slugPrefix?: string;
}

export interface McpTargetRule {
  effect: 'allow' | 'deny';
  capability: McpCapability;
  matcher: McpTargetRuleMatcher;
}

export interface McpClientPolicy {
  key: McpClientKey;
  label: string;
  capabilities: McpCapability[];
  targetRules: McpTargetRule[];
}

export interface ResolvedMcpClient {
  key: McpClientKey;
  externalId?: string;
  policy: McpClientPolicy;
}

export interface McpOAuthClientConfig {
  clientId?: string;
  redirectUris: string[];
}

export interface McpClientConfig extends McpClientPolicy {
  oauth?: McpOAuthClientConfig;
}

export function isMcpCapability(value: string): value is McpCapability {
  return (MCP_CAPABILITIES as readonly string[]).includes(value);
}

export function normalizeMcpGrants(grants: string[] | undefined): McpCapability[] | undefined {
  if (!grants) {
    return undefined;
  }

  return grants.filter(isMcpCapability);
}
