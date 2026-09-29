export {
  MANAGED_MCP_CLIENT_KEYS,
  type ManagedMcpClientKey,
} from "../../modules/permission-grant/permission-grant.constants";

export const MCP_CLIENT_KEYS = [
  "claude",
  "codex",
  "fallback",
  "unknown",
] as const;

export type McpClientKey = (typeof MCP_CLIENT_KEYS)[number] | `local:${string}`;

export interface McpAccess {
  resource: "preferences";
  action: "read" | "suggest" | "write" | "define";
}

export const MCP_CAPABILITIES = [
  "preferences:read",
  "preferences:suggest",
  "preferences:write",
  "preferences:define",
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
  effect: "allow" | "deny";
  capability: McpCapability;
  matcher: McpTargetRuleMatcher;
}

export interface McpClientPolicy {
  key: McpClientKey;
  label: string;
  capabilities: McpCapability[];
  targetRules: McpTargetRule[];
  /** Present only for independently authenticated local instances. Empty denies every target. */
  localTargets?: string[];
  allowSensitive?: boolean;
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

export function normalizeMcpGrants(
  grants: string[] | undefined,
): McpCapability[] {
  // Token-derived absence is no authority, never permission to restore policy maxima.
  return [...new Set((grants ?? []).filter(isMcpCapability))];
}
