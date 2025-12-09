import { registerAs } from '@nestjs/config';

export interface DocumentUploadConfig {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  maxSuggestions: number;
}

export default registerAs(
  'documentUpload',
  (): DocumentUploadConfig => ({
    maxFileSizeBytes: parseInt(
      process.env.DOC_UPLOAD_MAX_BYTES || '10485760', // 10MB default
      10,
    ),
    allowedMimeTypes: [
      'text/plain',
      'application/json',
      'application/pdf',
      'image/png',
      'image/jpeg',
    ],
    maxSuggestions: parseInt(process.env.DOC_UPLOAD_MAX_SUGGESTIONS || '25', 10),
  }),
);

export const getDocumentUploadConfig = (): DocumentUploadConfig => ({
  maxFileSizeBytes: parseInt(
    process.env.DOC_UPLOAD_MAX_BYTES || '10485760',
    10,
  ),
  allowedMimeTypes: [
    'text/plain',
    'application/json',
    'application/pdf',
    'image/png',
    'image/jpeg',
  ],
  maxSuggestions: parseInt(process.env.DOC_UPLOAD_MAX_SUGGESTIONS || '25', 10),
});
