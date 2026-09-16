import { Module } from '@nestjs/common';
import { VertexAiResolver } from './vertex-ai.resolver';

@Module({
  providers: [VertexAiResolver],
})
export class VertexAiModule {}
