/**
 * MCP Tool Scope Mapping
 *
 * Maps MCP tool names to the OAuth scopes required to call them.
 * This is used by the MCP auth guard to enforce scope-based access control.
 */

export const MCP_TOOL_SCOPES: Record<string, string[]> = {
  // Read-only tools require preferences:read
  search_preferences: ['preferences:read'],
  get_preference: ['preferences:read'],

  // Mutation tools require preferences:write
  create_preference: ['preferences:write'],
  update_preference: ['preferences:write'],
  delete_preference: ['preferences:write'],
};

/**
 * Default scope required if a tool is not explicitly mapped.
 * This provides a safe fallback - unknown tools require read access at minimum.
 */
export const DEFAULT_REQUIRED_SCOPE = 'preferences:read';

/**
 * Get the required scopes for a given tool name.
 */
export function getRequiredScopes(toolName: string): string[] {
  return MCP_TOOL_SCOPES[toolName] || [DEFAULT_REQUIRED_SCOPE];
}

/**
 * Check if the provided scopes satisfy the required scopes for a tool.
 */
export function hasRequiredScopes(
  toolName: string,
  providedScopes: string[],
): boolean {
  const required = getRequiredScopes(toolName);
  return required.every((scope) => providedScopes.includes(scope));
}

/**
 * Get the missing scopes for a tool given the provided scopes.
 */
export function getMissingScopes(
  toolName: string,
  providedScopes: string[],
): string[] {
  const required = getRequiredScopes(toolName);
  return required.filter((scope) => !providedScopes.includes(scope));
}
