import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../../types/mcp-context.type';
import { McpAccess } from '../../types/mcp-authorization.types';
import { McpToolExecutionResult } from '../../access-log/access-log.types';

export interface McpToolInterface {
  descriptor: Tool;
  requiresAuth: boolean;
  requiredAccess: McpAccess | readonly McpAccess[];
  accessLogPolicy?: 'default' | 'always';
  execute(args: unknown, context?: McpContext): Promise<McpToolExecutionResult>;
}
