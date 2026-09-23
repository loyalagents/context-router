import { registerAs } from '@nestjs/config';

export interface DocumentUploadConfig {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  maxSuggestions: number;
}

export const ALLOWED_DOCUMENT_UPLOAD_MIME_TYPES = [
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

export function createDocumentUploadConfiguration(
  environment: NodeJS.ProcessEnv,
): DocumentUploadConfig {
  return {
    maxFileSizeBytes: parseInt(
      environment.DOC_UPLOAD_MAX_BYTES || '10485760', // 10MB default
      10,
    ),
    allowedMimeTypes: [...ALLOWED_DOCUMENT_UPLOAD_MIME_TYPES],
    maxSuggestions: parseInt(
      environment.DOC_UPLOAD_MAX_SUGGESTIONS || '25',
      10,
    ),
  };
}

export function documentUploadConfigLoader(environment: NodeJS.ProcessEnv) {
  return registerAs('documentUpload', () =>
    createDocumentUploadConfiguration(environment),
  );
}
