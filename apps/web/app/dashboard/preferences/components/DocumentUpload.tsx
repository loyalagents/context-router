'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  DocumentAnalysisResult,
  UploadBatchFileResult,
  UploadBatchResult,
  UploadFileStatus,
} from '../types';

interface DocumentUploadProps {
  onAnalysisComplete: (result: UploadBatchResult) => void;
  accessToken: string;
}

const ALLOWED_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/yaml',
  'text/yaml',
  'application/x-yaml',
];
const EXTENSION_ALLOWED_TYPES = new Set(['.md', '.markdown', '.yml', '.yaml']);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BATCH_FILES = 10;

interface UploadQueueItem extends UploadBatchFileResult {
  file: File;
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) {
    return '';
  }

  return fileName.slice(lastDot).toLowerCase();
}

function validateFile(file: File): string | null {
  const extension = getFileExtension(file.name);
  const mimeAllowed = ALLOWED_TYPES.includes(file.type);
  const extensionAllowed = EXTENSION_ALLOWED_TYPES.has(extension);

  if (!mimeAllowed && !extensionAllowed) {
    const fileType = file.type || extension || 'unknown';
    return `Unsupported file type: ${fileType}. Allowed: PDF, PNG, JPEG, TXT, JSON, Markdown, YAML`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 10MB`;
  }
  return null;
}

function createFileId(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function toBatchResult(records: UploadQueueItem[]): UploadBatchResult {
  return {
    files: records.map((record) => ({
      id: record.id,
      fileName: record.fileName,
      fileSize: record.fileSize,
      status: record.status,
      result: record.result,
      error: record.error,
    })),
  };
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function getStatusLabel(status: UploadFileStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'analyzing':
      return 'Analyzing';
    case 'success':
      return 'Ready';
    case 'no_matches':
      return 'No matches';
    case 'parse_error':
      return 'Parse error';
    case 'ai_error':
      return 'AI error';
    case 'validation_error':
      return 'Invalid';
    case 'upload_error':
      return 'Upload error';
  }
}

export default function DocumentUpload({
  onAnalysisComplete,
  accessToken,
}: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setError(null);
    setQueue([]);

    if (files.length > MAX_BATCH_FILES) {
      setError(`Upload up to ${MAX_BATCH_FILES} files at a time.`);
      return;
    }

    let records: UploadQueueItem[] = files.map((file, index) => {
      const validationError = validateFile(file);

      return {
        id: createFileId(file, index),
        file,
        fileName: file.name,
        fileSize: file.size,
        status: validationError ? 'validation_error' : 'queued',
        error: validationError ?? undefined,
      };
    });

    const publishRecords = () => {
      setQueue(records.map((record) => ({ ...record })));
    };

    const updateRecord = (
      id: string,
      patch: Partial<Omit<UploadQueueItem, 'id' | 'file' | 'fileName' | 'fileSize'>>,
    ) => {
      records = records.map((record) =>
        record.id === id ? { ...record, ...patch } : record,
      );
      publishRecords();
    };

    setIsUploading(true);
    publishRecords();

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';

    for (const record of records) {
      if (record.status === 'validation_error') {
        continue;
      }

      updateRecord(record.id, { status: 'analyzing', error: undefined });

      try {
        const formData = new FormData();
        formData.append('file', record.file);

        const response = await fetch(`${backendUrl}/api/preferences/analysis`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Upload failed: ${response.statusText}`);
        }

        const result: DocumentAnalysisResult = await response.json();
        updateRecord(record.id, {
          status: result.status,
          result,
          error: result.status === 'success' ? undefined : result.statusReason ?? undefined,
        });
      } catch (err) {
        updateRecord(record.id, {
          status: 'upload_error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    }

    const completedBatch = toBatchResult(records);
    setIsUploading(false);
    onAnalysisComplete(completedBatch);
  }, [accessToken, onAnalysisComplete]);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      uploadFiles(Array.from(files));
    },
    [uploadFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isUploading) {
      setIsDragging(true);
    }
  }, [isUploading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (isUploading) {
        return;
      }

      handleFiles(e.dataTransfer.files);
    },
    [handleFiles, isUploading],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      handleFiles(selectedFiles);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  };

  const analyzedCount = queue.filter(
    (item) => item.status !== 'queued' && item.status !== 'analyzing',
  ).length;
  const activeFile = queue.find((item) => item.status === 'analyzing');
  const progressCount = activeFile
    ? Math.min(queue.length, analyzedCount + 1)
    : analyzedCount;

  return (
    <div className="w-full">
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${isUploading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={[...ALLOWED_TYPES, ...EXTENSION_ALLOWED_TYPES].join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />

        {isUploading ? (
          <div className="space-y-3">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-gray-600">
              Analyzing {progressCount} of {queue.length} files...
            </p>
            {activeFile && (
              <p className="text-sm text-gray-400 truncate">{activeFile.fileName}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="w-12 h-12 mx-auto text-gray-400">
              <svg
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                className="w-full h-full"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <div>
              <p className="text-gray-600">
                <span className="text-blue-600 font-medium">Click to upload</span> or drag
                and drop
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Up to {MAX_BATCH_FILES} files. PDF, PNG, JPEG, TXT, JSON, Markdown, or YAML
                (max 10MB each)
              </p>
            </div>
          </div>
        )}
      </div>

      {queue.length > 0 && isUploading && (
        <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {queue.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-gray-700">{item.fileName}</p>
                <p className="text-xs text-gray-400">{formatFileSize(item.fileSize)}</p>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                  item.status === 'validation_error' || item.status === 'upload_error'
                    ? 'bg-red-50 text-red-700'
                    : item.status === 'success'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                }`}
              >
                {getStatusLabel(item.status)}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
