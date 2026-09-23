import { registerAs } from '@nestjs/config';

export interface FormFillConfig {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  // Diagnostic threshold only; otherwise valid source-backed actions are applied.
  confidenceThreshold: number;
}

export const ALLOWED_FORM_FILL_MIME_TYPES = ['application/pdf'];

export function createFormFillConfiguration(
  environment: NodeJS.ProcessEnv,
): FormFillConfig {
  return {
    maxFileSizeBytes: parseInt(
      environment.FORM_FILL_MAX_BYTES || '10485760',
      10,
    ),
    allowedMimeTypes: [...ALLOWED_FORM_FILL_MIME_TYPES],
    confidenceThreshold: parseFloat(
      environment.FORM_FILL_CONFIDENCE_THRESHOLD || '0.75',
    ),
  };
}

export function formFillConfigLoader(environment: NodeJS.ProcessEnv) {
  return registerAs('formFill', () => createFormFillConfiguration(environment));
}
