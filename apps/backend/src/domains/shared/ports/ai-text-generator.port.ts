export interface FileInput {
  buffer: Buffer;
  mimeType: string;
}

export interface AiTextGeneratorPort {
  generateText(prompt: string): Promise<string>;

  /**
   * Generate text from a prompt with an attached file (for multimodal models).
   * The file buffer is passed directly to the model for native processing.
   */
  generateTextWithFile(prompt: string, file: FileInput): Promise<string>;
}
