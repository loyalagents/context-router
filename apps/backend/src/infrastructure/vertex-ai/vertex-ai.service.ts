import { Injectable, Logger } from '@nestjs/common';
import {
  VertexAI,
  GenerativeModel,
  GenerateContentResult,
  Part,
} from '@google-cloud/vertexai';
import {
  AiTextGeneratorPort,
  FileInput,
} from '../../domains/shared/ports/ai-text-generator.port';
import { getVertexAiConfig } from '../../config/vertex-ai.config';

@Injectable()
export class VertexAiService implements AiTextGeneratorPort {
  private readonly logger = new Logger(VertexAiService.name);
  private readonly vertexAI: VertexAI;
  private readonly model: GenerativeModel;

  constructor() {
    const config = getVertexAiConfig();

    this.logger.log(
      `Initializing Vertex AI with project: ${config.projectId}, region: ${config.region}, model: ${config.modelId}`,
    );

    this.vertexAI = new VertexAI({
      project: config.projectId,
      location: config.region,
    });

    this.model = this.vertexAI.getGenerativeModel({
      model: config.modelId,
    });
  }

  async generateText(prompt: string): Promise<string> {
    try {
      this.logger.log(`Generating text for prompt: ${prompt.substring(0, 50)}...`);

      const request = {
        contents: [
          {
            role: 'user' as const,
            parts: [{ text: prompt }],
          },
        ],
      };

      const response: GenerateContentResult =
        await this.model.generateContent(request);
      const candidates = response.response.candidates ?? [];
      const firstCandidate = candidates[0];

      if (!firstCandidate?.content?.parts?.length) {
        this.logger.warn('No candidates returned from Vertex AI');
        return '';
      }

      const text = firstCandidate.content.parts
        .map((part) => part.text ?? '')
        .join('');

      this.logger.log(`Generated ${text.length} characters of text`);
      return text;
    } catch (error) {
      this.logger.error('Error calling Vertex AI', error);
      throw error;
    }
  }

  async generateTextWithFile(prompt: string, file: FileInput): Promise<string> {
    try {
      this.logger.log(
        `Generating text with file (${file.mimeType}, ${file.buffer.length} bytes)`,
      );

      // Build parts array with file data and text prompt
      const parts: Part[] = [
        {
          inlineData: {
            mimeType: file.mimeType,
            data: file.buffer.toString('base64'),
          },
        },
        { text: prompt },
      ];

      const request = {
        contents: [
          {
            role: 'user' as const,
            parts,
          },
        ],
      };

      const response: GenerateContentResult =
        await this.model.generateContent(request);
      const candidates = response.response.candidates ?? [];
      const firstCandidate = candidates[0];

      if (!firstCandidate?.content?.parts?.length) {
        this.logger.warn('No candidates returned from Vertex AI');
        return '';
      }

      const text = firstCandidate.content.parts
        .map((part) => part.text ?? '')
        .join('');

      this.logger.log(`Generated ${text.length} characters of text from file`);
      return text;
    } catch (error) {
      this.logger.error('Error calling Vertex AI with file', error);
      throw error;
    }
  }
}
