import { MCP_TOOLS } from './mcp.constants';
import { PreferenceListTool } from './tools/preference-list.tool';
import { PreferenceSearchTool } from './tools/preference-search.tool';
import { PreferenceMutateTool } from './tools/preference-mutate.tool';
import { SmartSearchTool } from './tools/smart-search.tool';
import { SchemaConsolidationTool } from './tools/schema-consolidation.tool';
import { PermissionGrantListTool } from './tools/permission-grant-list.tool';

const tools = [
  PreferenceListTool,
  PreferenceSearchTool,
  PreferenceMutateTool,
  SmartSearchTool,
  SchemaConsolidationTool,
  PermissionGrantListTool,
];
/** Shared business handlers; authentication and transport stay at each composition edge. */
export const mcpToolProviders = [
  ...tools,
  {
    provide: MCP_TOOLS,
    inject: tools,
    useFactory: (...instances) => instances,
  },
];
