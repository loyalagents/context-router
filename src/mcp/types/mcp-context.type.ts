/**
 * User context extracted from JWT token
 * Passed to all MCP tool handlers to ensure user-scoped operations
 */
export interface McpUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Context object passed to MCP tool handlers
 * Contains authenticated user information
 */
export interface McpContext {
  user: McpUser;
}
