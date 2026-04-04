import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../../types/mcp-context.type';
import { McpAccess } from '../../types/mcp-authorization.types';

export interface McpToolInterface {
  descriptor: Tool;
  requiresAuth: boolean;
  requiredAccess: McpAccess;
  execute(args: unknown, context?: McpContext): Promise<CallToolResult>;
}
