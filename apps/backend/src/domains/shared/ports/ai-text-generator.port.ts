export interface FileInput {
  buffer: Buffer;
  mimeType: string;
}

export interface AiTextGeneratorPort extends AiCapabilityProvider {
  generateText(prompt: string, options?: AiExecutionOptions): Promise<string>;

  /**
   * Generate text from an attached file supported by the configured capabilities.
   */
  generateTextWithFile(
    prompt: string,
    file: FileInput,
    options?: AiExecutionOptions,
  ): Promise<string>;
}
import type { AiCapabilityProvider, AiExecutionOptions } from "./ai-execution";
