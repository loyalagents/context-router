import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type ReadToolSuccessPayload = {
  success: true;
  [key: string]: unknown;
};

export function buildReadToolSuccessResult<T extends ReadToolSuccessPayload>(
  _toolName: string,
  _summary: string,
  structuredContent: T,
): CallToolResult {
  // Duplicate structuredContent into text for MCP clients that only surface
  // content blocks, while keeping structuredContent as the preferred payload.
  const text = JSON.stringify(structuredContent, null, 2);
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    structuredContent,
  };
}

export function buildReadToolErrorResult(
  _toolName: string,
  message: string,
): CallToolResult {
  const structuredContent = {
    success: false,
    error: message,
  };
  const text = JSON.stringify(structuredContent, null, 2);

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    structuredContent,
    isError: true,
  };
}
