import { registerAs } from '@nestjs/config';

export interface FormFillConfig {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  confidenceThreshold: number;
}

const ALLOWED_FORM_FILL_MIME_TYPES = ['application/pdf'];

export default registerAs(
  'formFill',
  (): FormFillConfig => ({
    maxFileSizeBytes: parseInt(
      process.env.FORM_FILL_MAX_BYTES || '10485760',
      10,
    ),
    allowedMimeTypes: ALLOWED_FORM_FILL_MIME_TYPES,
    confidenceThreshold: parseFloat(
      process.env.FORM_FILL_CONFIDENCE_THRESHOLD || '0.75',
    ),
  }),
);

export const getFormFillConfig = (): FormFillConfig => ({
  maxFileSizeBytes: parseInt(
    process.env.FORM_FILL_MAX_BYTES || '10485760',
    10,
  ),
  allowedMimeTypes: ALLOWED_FORM_FILL_MIME_TYPES,
  confidenceThreshold: parseFloat(
    process.env.FORM_FILL_CONFIDENCE_THRESHOLD || '0.75',
  ),
});
