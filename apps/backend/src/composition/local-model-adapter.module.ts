import {
  Global,
  Injectable,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { z } from "zod";

import type {
  AiStructuredOptions,
  AiStructuredOutputPort,
} from "../domains/shared/ports/ai-structured-output.port";
import type {
  AiTextGeneratorPort,
  FileInput,
} from "../domains/shared/ports/ai-text-generator.port";
import {
  AI_STRUCTURED_OUTPUT_PORT,
  AI_TEXT_GENERATOR_PORT,
} from "../domains/shared/ports/ai.tokens";

export const LOCAL_MODEL_UNAVAILABLE_MESSAGE = "Local model is unavailable";

function unavailable(): never {
  throw new ServiceUnavailableException(LOCAL_MODEL_UNAVAILABLE_MESSAGE);
}

@Injectable()
export class LocalUnavailableModelService
  implements AiTextGeneratorPort, AiStructuredOutputPort
{
  async generateText(_prompt: string): Promise<string> {
    return unavailable();
  }

  async generateTextWithFile(
    _prompt: string,
    _file: FileInput,
  ): Promise<string> {
    return unavailable();
  }

  async generateStructured<T>(
    _prompt: string,
    _schema: z.ZodType<T>,
    _options?: AiStructuredOptions,
  ): Promise<T> {
    return unavailable();
  }

  async generateStructuredWithFile<T>(
    _prompt: string,
    _file: FileInput,
    _schema: z.ZodType<T>,
    _options?: AiStructuredOptions,
  ): Promise<T> {
    return unavailable();
  }
}

@Global()
@Module({
  providers: [
    LocalUnavailableModelService,
    {
      provide: AI_TEXT_GENERATOR_PORT,
      useExisting: LocalUnavailableModelService,
    },
    {
      provide: AI_STRUCTURED_OUTPUT_PORT,
      useExisting: LocalUnavailableModelService,
    },
  ],
  exports: [AI_TEXT_GENERATOR_PORT, AI_STRUCTURED_OUTPUT_PORT],
})
export class LocalModelAdapterModule {}
