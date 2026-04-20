import {
  Resource,
} from '@modelcontextprotocol/sdk/types.js';
import { McpAccess } from '../../types/mcp-authorization.types';
import { McpContext } from '../../types/mcp-context.type';
import { McpResourceExecutionResult } from '../../access-log/access-log.types';

export interface McpResourceInterface {
  descriptor: Resource;
  requiredAccess: McpAccess;
  read(context: McpContext): Promise<McpResourceExecutionResult>;
}
