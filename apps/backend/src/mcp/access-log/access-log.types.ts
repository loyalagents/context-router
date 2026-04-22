import {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  McpAccessOutcome,
  McpAccessSurface,
  Prisma,
} from '@infrastructure/prisma/generated-client';

export interface McpAccessLogMetadata {
  requestMetadata?: Prisma.InputJsonValue | null;
  responseMetadata?: Prisma.InputJsonValue | null;
  errorMetadata?: Prisma.InputJsonValue | null;
}

export interface McpToolExecutionResult {
  result: CallToolResult;
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
