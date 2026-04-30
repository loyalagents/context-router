import { readFile } from 'node:fs/promises';
import { DiscoveredFile } from './types';

const MAX_PREVIEW_BYTES = 8 * 1024;
const MAX_PREVIEW_LINES = 200;

export interface FileTextPreview {
  text: string;
  truncated: boolean;
  lineCount: number;
  byteCount: number;
  encoding: 'utf-8';
}

export async function buildTextPreview(
  file: DiscoveredFile,
): Promise<FileTextPreview | null> {
  if (!isPreviewableTextFile(file)) {
    return null;
  }

  const buffer = await readFile(file.path);
  const sliced = buffer.subarray(0, MAX_PREVIEW_BYTES);
  const decoded = sliced.toString('utf8');
  const lines = decoded.split(/\r?\n/);
  const limitedLines = lines.slice(0, MAX_PREVIEW_LINES);
  const text = limitedLines.join('\n');
  const lineTruncated = lines.length > MAX_PREVIEW_LINES;
  const byteTruncated = buffer.length > MAX_PREVIEW_BYTES;

  return {
    text,
    truncated: byteTruncated || lineTruncated,
    lineCount: limitedLines.length,
    byteCount: sliced.length,
    encoding: 'utf-8',
  };
}

export function isPreviewableTextFile(file: DiscoveredFile): boolean {
  return (
    file.uploadMimeType === 'text/plain' || file.uploadMimeType === 'application/json'
  );
}
