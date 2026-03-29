import { Module } from '@nestjs/common';
import { VertexAiService } from '../../infrastructure/vertex-ai/vertex-ai.service';
import { VertexAiStructuredService } from '../../infrastructure/vertex-ai/vertex-ai-structured.service';
import { VertexAiResolver } from './vertex-ai.resolver';

@Module({
  providers: [
    VertexAiService,
    VertexAiStructuredService,
    VertexAiResolver,
    {
      provide: 'AiTextGeneratorPort',
      useExisting: VertexAiService,
    },
    {
      provide: 'AiStructuredOutputPort',
      useExisting: VertexAiStructuredService,
    },
  ],
  exports: [
    VertexAiService,
    VertexAiStructuredService,
    { provide: 'AiTextGeneratorPort', useExisting: VertexAiService },
    'AiStructuredOutputPort',
  ],
})
export class VertexAiModule {}
