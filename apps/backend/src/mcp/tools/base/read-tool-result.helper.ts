import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type ReadToolSuccessPayload = {
  success: true;
  [key: string]: unknown;
};

export function buildReadToolSuccessResult<T extends ReadToolSuccessPayload>(
  toolName: string,
  summary: string,
  structuredContent: T,
): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `${toolName}: ${summary}`,
      },
    ],
    structuredContent,
  };
}

export function buildReadToolErrorResult(
  toolName: string,
  message: string,
): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `${toolName}: error — ${message}`,
      },
    ],
    structuredContent: {
      success: false,
      error: message,
    },
    isError: true,
  };
}
