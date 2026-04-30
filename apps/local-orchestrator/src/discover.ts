import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DiscoveredFile, FileRunRecord } from './types';

interface UploadMimeInfo {
  originalMimeType: string | null;
  uploadMimeType: string;
  coercedToPlainText: boolean;
}

export interface DiscoveryOptions {
  includeHidden?: boolean;
}

export interface DiscoveryResult {
  hiddenEntriesSkipped: number;
  files: FileRunRecord[];
}

const DIRECT_MIME_BY_EXTENSION: Record<string, UploadMimeInfo> = {
  '.txt': {
    originalMimeType: 'text/plain',
    uploadMimeType: 'text/plain',
    coercedToPlainText: false,
  },
  '.json': {
    originalMimeType: 'application/json',
    uploadMimeType: 'application/json',
    coercedToPlainText: false,
  },
  '.pdf': {
    originalMimeType: 'application/pdf',
    uploadMimeType: 'application/pdf',
    coercedToPlainText: false,
  },
  '.png': {
    originalMimeType: 'image/png',
    uploadMimeType: 'image/png',
    coercedToPlainText: false,
  },
  '.jpg': {
    originalMimeType: 'image/jpeg',
    uploadMimeType: 'image/jpeg',
    coercedToPlainText: false,
  },
  '.jpeg': {
    originalMimeType: 'image/jpeg',
    uploadMimeType: 'image/jpeg',
    coercedToPlainText: false,
  },
  '.md': {
    originalMimeType: 'text/markdown',
    uploadMimeType: 'text/markdown',
    coercedToPlainText: false,
  },
  '.markdown': {
    originalMimeType: 'text/markdown',
    uploadMimeType: 'text/markdown',
    coercedToPlainText: false,
  },
  '.yml': {
    originalMimeType: 'application/yaml',
    uploadMimeType: 'application/yaml',
    coercedToPlainText: false,
  },
  '.yaml': {
    originalMimeType: 'application/yaml',
    uploadMimeType: 'application/yaml',
    coercedToPlainText: false,
  },
};

const COERCED_TEXT_MIME_BY_EXTENSION: Record<string, UploadMimeInfo> = {
  '.toml': {
    originalMimeType: 'application/toml',
    uploadMimeType: 'text/plain',
    coercedToPlainText: true,
  },
  '.ini': {
    originalMimeType: null,
    uploadMimeType: 'text/plain',
    coercedToPlainText: true,
  },
  '.cfg': {
    originalMimeType: null,
    uploadMimeType: 'text/plain',
    coercedToPlainText: true,
  },
  '.conf': {
    originalMimeType: null,
    uploadMimeType: 'text/plain',
    coercedToPlainText: true,
  },
};

const BASENAME_MATCHERS: Array<(fileName: string) => UploadMimeInfo | null> = [
  (fileName) =>
    fileName === '.env' || fileName.startsWith('.env.')
      ? {
          originalMimeType: null,
          uploadMimeType: 'text/plain',
          coercedToPlainText: true,
        }
      : null,
];

export async function discoverFiles(
  rootFolder: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const files: FileRunRecord[] = [];
  let hiddenEntriesSkipped = 0;

  await walkDirectory(rootFolder);

  return {
    hiddenEntriesSkipped,
    files,
  };

  async function walkDirectory(currentFolder: string): Promise<void> {
    const entries = await fs.readdir(currentFolder, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentFolder, entry.name);

      if (!options.includeHidden && entry.name.startsWith('.')) {
        hiddenEntriesSkipped += 1;
        continue;
      }

      if (entry.isDirectory()) {
        await walkDirectory(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(rootFolder, absolutePath) || entry.name;
      const extension = path.extname(entry.name).toLowerCase();
      const mimeInfo = getUploadMimeInfo(entry.name, extension);
      const stats = await fs.stat(absolutePath);

      if (!mimeInfo) {
        files.push({
          path: absolutePath,
          relativePath,
          sizeBytes: stats.size,
          extension,
          originalMimeType: null,
          uploadMimeType: null,
          discovery: {
            action: 'skip',
            reason: 'unsupported_extension',
            details: `Unsupported extension "${extension || '[none]'}"`,
          },
        });
        continue;
      }

      const file = toDiscoveredFile({
        absolutePath,
        relativePath,
        sizeBytes: stats.size,
        extension,
        uploadMimeInfo: mimeInfo,
      });

      files.push({
        file,
        path: absolutePath,
        relativePath,
        sizeBytes: stats.size,
        extension,
        originalMimeType: file.originalMimeType,
        uploadMimeType: file.uploadMimeType,
        discovery: {
          action: 'analyze',
          reason: mimeInfo.coercedToPlainText
            ? 'coerced_to_text_plain'
            : 'supported_extension',
        },
      });
    }
  }
}

function getUploadMimeInfo(
  fileName: string,
  extension: string,
): UploadMimeInfo | null {
  for (const matcher of BASENAME_MATCHERS) {
    const match = matcher(fileName);
    if (match) {
      return match;
    }
  }

  return (
    DIRECT_MIME_BY_EXTENSION[extension] ??
    COERCED_TEXT_MIME_BY_EXTENSION[extension] ??
    null
  );
}

function toDiscoveredFile(params: {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  extension: string;
  uploadMimeInfo: UploadMimeInfo;
}): DiscoveredFile {
  return {
    path: params.absolutePath,
    relativePath: params.relativePath,
    sizeBytes: params.sizeBytes,
    extension: params.extension,
    originalMimeType: params.uploadMimeInfo.originalMimeType,
    uploadMimeType: params.uploadMimeInfo.uploadMimeType,
    uploadFileName: path.basename(params.absolutePath),
    coercedToPlainText: params.uploadMimeInfo.coercedToPlainText,
  };
}
