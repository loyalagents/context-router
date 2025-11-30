import { Module } from '@nestjs/common';
import { VertexAiService } from '../../infrastructure/vertex-ai/vertex-ai.service';
import { VertexAiResolver } from './vertex-ai.resolver';

@Module({
  providers: [
    VertexAiService,
    VertexAiResolver,
    {
      provide: 'AiTextGeneratorPort',
      useExisting: VertexAiService,
    },
  ],
  exports: [
    VertexAiService,
    { provide: 'AiTextGeneratorPort', useExisting: VertexAiService },
  ],
})
export class VertexAiModule {}
