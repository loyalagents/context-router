/**
 * User context extracted from API-key-authenticated HTTP requests.
 * Passed to MCP tool handlers to ensure user-scoped operations.
 */
export interface McpUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Context object passed to MCP tool handlers.
 */
export interface McpContext {
  user: McpUser;
}
