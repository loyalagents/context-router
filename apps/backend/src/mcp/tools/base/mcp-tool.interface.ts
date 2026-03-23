import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../../types/mcp-context.type';

export interface McpToolInterface {
  descriptor: Tool;
  requiresAuth: boolean;
  execute(args: unknown, context?: McpContext): Promise<CallToolResult>;
}
