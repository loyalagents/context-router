import { Global, Module } from '@nestjs/common';
import {
  AI_STRUCTURED_OUTPUT_PORT,
  AI_TEXT_GENERATOR_PORT,
} from '../domains/shared/ports/ai.tokens';
import { VertexAiStructuredService } from '../infrastructure/vertex-ai/vertex-ai-structured.service';
import { VertexAiService } from '../infrastructure/vertex-ai/vertex-ai.service';

@Global()
@Module({
  providers: [
    VertexAiService,
    VertexAiStructuredService,
    {
      provide: AI_TEXT_GENERATOR_PORT,
      useExisting: VertexAiService,
    },
    {
      provide: AI_STRUCTURED_OUTPUT_PORT,
      useExisting: VertexAiStructuredService,
    },
  ],
  exports: [AI_TEXT_GENERATOR_PORT, AI_STRUCTURED_OUTPUT_PORT],
})
export class HostedModelAdapterModule {}
