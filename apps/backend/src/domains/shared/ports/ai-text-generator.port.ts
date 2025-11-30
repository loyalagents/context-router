export interface AiTextGeneratorPort {
  generateText(prompt: string): Promise<string>;
}
