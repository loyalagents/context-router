import { z } from 'zod';
import { FileInput } from './ai-text-generator.port';

export interface AiStructuredOptions {
  retries?: number;
  operationName?: string; // used for logging/tracing (e.g. 'preferenceSearch.slugIdentification')
}

export interface AiStructuredOutputPort {
  generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AiStructuredOptions,
  ): Promise<T>;

  generateStructuredWithFile<T>(
    prompt: string,
    file: FileInput,
    schema: z.ZodType<T>,
    options?: AiStructuredOptions,
  ): Promise<T>;
}
