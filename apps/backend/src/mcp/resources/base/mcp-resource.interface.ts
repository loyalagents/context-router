import {
  ReadResourceResult,
  Resource,
} from '@modelcontextprotocol/sdk/types.js';
import { McpAccess } from '../../types/mcp-authorization.types';
import { McpContext } from '../../types/mcp-context.type';

export interface McpResourceInterface {
  descriptor: Resource;
  requiredAccess: McpAccess;
  read(context: McpContext): Promise<ReadResourceResult>;
}
