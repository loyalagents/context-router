import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  AiStructuredOutputPort,
  AiStructuredOptions,
} from '../../domains/shared/ports/ai-structured-output.port';
import { FileInput } from '../../domains/shared/ports/ai-text-generator.port';
import { VertexAiService } from './vertex-ai.service';

/**
 * Escapes literal (unescaped) newlines inside JSON string values.
 * AI models sometimes produce JSON with raw newlines in strings,
 * which breaks JSON.parse(). This fixes them before parsing.
 */
function escapeLiteralNewlinesInJsonStrings(input: string): string {
  return input.replace(
    /"((?:[^"\\]|\\.)*)"/gs,
    (_, content: string) =>
      `"${content
        .replace(/\r\n/g, '\\n')
        .replace(/\r/g, '\\n')
        .replace(/\n/g, '\\n')}"`,
  );
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```) from AI output.
 */
function stripMarkdownFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

interface NullFillActionValue {
  index: number;
  action: string;
  fieldName: string;
}

function normalizedNullFillActionValues(parsed: unknown): NullFillActionValue[] {
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const fillActions = (parsed as { fillActions?: unknown }).fillActions;
  if (!Array.isArray(fillActions)) {
    return [];
  }

  return fillActions.flatMap((action, index) => {
    if (!action || typeof action !== 'object') {
      return [];
    }

    const fillAction = action as {
      action?: unknown;
      fieldName?: unknown;
      value?: unknown;
    };

    if (fillAction.value !== null) {
      return [];
    }

    return [
      {
        index,
        action:
          typeof fillAction.action === 'string'
            ? fillAction.action
            : '<non-string-action>',
        fieldName:
          typeof fillAction.fieldName === 'string'
            ? fillAction.fieldName
            : '<non-string-field>',
      },
    ];
  });
}

@Injectable()
export class VertexAiStructuredService implements AiStructuredOutputPort {
  private readonly logger = new Logger(VertexAiStructuredService.name);

  constructor(private readonly vertexAiService: VertexAiService) {}

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AiStructuredOptions,
  ): Promise<T> {
    const opName = options?.operationName ?? 'generateStructured';
    const retries = options?.retries ?? 1;

    const rawText = await this.vertexAiService.generateText(prompt);
    return this.parseAndValidate(rawText, schema, prompt, retries, opName);
  }

  async generateStructuredWithFile<T>(
    prompt: string,
    file: FileInput,
    schema: z.ZodType<T>,
    options?: AiStructuredOptions,
  ): Promise<T> {
    const opName = options?.operationName ?? 'generateStructuredWithFile';
    const retries = options?.retries ?? 1;

    const rawText = await this.vertexAiService.generateTextWithFile(
      prompt,
      file,
    );
    return this.parseAndValidate(rawText, schema, prompt, retries, opName, file);
  }

  private async parseAndValidate<T>(
    rawText: string,
    schema: z.ZodType<T>,
    originalPrompt: string,
    retriesRemaining: number,
    operationName: string,
    file?: FileInput,
  ): Promise<T> {
    const cleaned = stripMarkdownFences(rawText);
    const escaped = escapeLiteralNewlinesInJsonStrings(cleaned);

    // Step 1: JSON.parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(escaped);
    } catch (parseError) {
      this.logger.error(
        `[${operationName}] JSON.parse failed: ${parseError.message}`,
      );

      if (retriesRemaining > 0) {
        return this.correctionRetry(
          schema,
          originalPrompt,
          rawText,
          `JSON parse error: ${parseError.message}`,
          retriesRemaining - 1,
          operationName,
          file,
        );
      }

      throw new Error(
        `[${operationName}] Failed to parse AI response as JSON: ${parseError.message}`,
      );
    }

    this.logNormalizedNullFillActionValues(operationName, parsed);

    // Step 2: Zod validation
    const result = schema.safeParse(parsed);

    if (result.success) {
      this.logger.debug(`[${operationName}] Parsed and validated successfully`);
      return result.data;
    }

    const zodErrors = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');

    this.logger.error(
      `[${operationName}] Zod validation failed: ${zodErrors}`,
    );

    if (retriesRemaining > 0) {
      return this.correctionRetry(
        schema,
        originalPrompt,
        rawText,
        `Validation errors: ${zodErrors}`,
        retriesRemaining - 1,
        operationName,
        file,
      );
    }

    throw new Error(
      `[${operationName}] AI response failed validation: ${zodErrors}`,
    );
  }

  private async correctionRetry<T>(
    schema: z.ZodType<T>,
    originalPrompt: string,
    invalidOutput: string,
    errorDescription: string,
    retriesRemaining: number,
    operationName: string,
    file?: FileInput,
  ): Promise<T> {
    this.logger.warn(
      `[${operationName}] Attempting correction retry (${retriesRemaining} retries left after this)`,
    );

    const correctionPrompt = `The previous response was invalid. Please fix it and respond with valid JSON only.

Original prompt:
${originalPrompt}

Your previous (invalid) response:
${invalidOutput}

Error:
${errorDescription}

Please respond with corrected, valid JSON only. No markdown fences.`;

    const correctedText = file
      ? await this.vertexAiService.generateTextWithFile(correctionPrompt, file)
      : await this.vertexAiService.generateText(correctionPrompt);
    return this.parseAndValidate(
      correctedText,
      schema,
      originalPrompt,
      retriesRemaining,
      operationName,
      file,
    );
  }

  private logNormalizedNullFillActionValues(
    operationName: string,
    parsed: unknown,
  ): void {
    if (operationName !== 'formFill.fillActions') {
      return;
    }

    const nullValues = normalizedNullFillActionValues(parsed);
    if (nullValues.length === 0) {
      return;
    }

    const actions = nullValues
      .map(
        (entry) =>
          `${entry.index}:${entry.action}:${JSON.stringify(entry.fieldName)}`,
      )
      .join(', ');

    this.logger.warn(
      `[${operationName}] Normalized null fill action value(s) to omitted values: count=${nullValues.length} actions=${actions}`,
    );
  }
}
