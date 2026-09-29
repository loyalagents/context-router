/**
 * User context extracted from JWT token
 * Passed to all MCP tool handlers to ensure user-scoped operations
 */
import {
  McpCapability,
  ResolvedMcpClient,
} from './mcp-authorization.types';
import type { AiExecutionOptions } from '../../domains/shared/ports/ai-execution';

export interface McpUser {
  userId: string;
  email: string;
}

/**
 * Context object passed to MCP tool handlers
 * Contains authenticated user information
 */
export interface McpContext {
  user: McpUser;
  client: ResolvedMcpClient;
  grants?: McpCapability[];
  correlationId?: string;
  /** Trusted local transport controls, never client-supplied arguments. */
  execution?: AiExecutionOptions;
}
