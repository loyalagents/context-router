import {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  McpAccessOutcome,
  McpAccessSurface,
  JsonInput,
} from '@/domains/shared/storage/storage-types';

export interface McpAccessLogMetadata {
  requestMetadata?: JsonInput | null;
  responseMetadata?: JsonInput | null;
  errorMetadata?: JsonInput | null;
}

export interface McpToolExecutionResult {
  result: CallToolResult;
  outcome?: McpAccessOutcome;
  accessLog?: McpAccessLogMetadata;
}

export interface McpResourceExecutionResult {
  result: ReadResourceResult;
  accessLog?: McpAccessLogMetadata;
}

export interface McpAccessEventInput extends McpAccessLogMetadata {
  userId: string;
  clientKey: string;
  surface: McpAccessSurface;
  operationName: string;
  outcome: McpAccessOutcome;
  correlationId: string;
  latencyMs: number;
}
