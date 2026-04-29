import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { DiscoveredFile, DocumentAnalysisResult } from '../types';
import { RequestError } from './request-error';

export interface AnalysisClientOptions {
  backendUrl: string;
  token: string;
}

export class AnalysisClient {
  constructor(private readonly options: AnalysisClientOptions) {}

  async analyzeFile(file: DiscoveredFile): Promise<DocumentAnalysisResult> {
    const buffer = await readFile(file.path);
    const body = new FormData();
    body.append(
      'file',
      new Blob([buffer], { type: file.uploadMimeType }),
      file.uploadFileName,
    );

    let response: Response;

    try {
      response = await fetch(
        new URL('/api/preferences/analysis', this.options.backendUrl),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.token}`,
          },
          body,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new RequestError(error.message, 'timeout');
      }
      throw new RequestError(
        error instanceof Error ? error.message : 'Network request failed',
        'network',
      );
    }

    if (!response.ok) {
      const message = await readErrorMessage(response);
      const kind =
        response.status === 401 || response.status === 403 ? 'auth' : 'http';
      throw new RequestError(message, kind, response.status);
    }

    try {
      return (await response.json()) as DocumentAnalysisResult;
    } catch (error) {
      throw new RequestError(
        error instanceof Error ? error.message : 'Invalid JSON response',
        'invalid_response',
      );
    }
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { message?: string };
    if (typeof parsed.message === 'string' && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // fall through
  }

  const text = await response.text().catch(() => '');
  return text || `Analysis request failed with status ${response.status}`;
}
