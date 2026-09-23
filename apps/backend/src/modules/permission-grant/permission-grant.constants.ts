export const MANAGED_MCP_CLIENT_KEYS = ["claude", "codex", "fallback"] as const;

export type ManagedMcpClientKey = (typeof MANAGED_MCP_CLIENT_KEYS)[number];
