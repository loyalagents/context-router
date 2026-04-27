import { RequestErrorRecord } from '../types';

export class RequestError extends Error {
  constructor(
    message: string,
    readonly kind: RequestErrorRecord['kind'],
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export function toRequestErrorRecord(error: unknown): RequestErrorRecord {
  if (error instanceof RequestError) {
    return {
      kind: error.kind,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  if (error instanceof Error) {
    return {
      kind: 'network',
      message: error.message,
    };
  }

  return {
    kind: 'network',
    message: 'Unknown request error',
  };
}
