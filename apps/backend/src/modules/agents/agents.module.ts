import { Module } from '@nestjs/common';
import { VertexAiModule } from '../vertex-ai/vertex-ai.module';
import { PreferenceDefinitionModule } from '../preferences/preference-definition/preference-definition.module';
import { PreferenceModule } from '../preferences/preference/preference.module';
import { PreferenceSearchAgent } from './preferences/preference-search/preference-search.agent';
import { SchemaConsolidationAgent } from './preferences/schema-consolidation/schema-consolidation.agent';

@Module({
  imports: [VertexAiModule, PreferenceDefinitionModule, PreferenceModule],
  providers: [PreferenceSearchAgent, SchemaConsolidationAgent],
  exports: [PreferenceSearchAgent, SchemaConsolidationAgent],
})
export class AgentsModule {}
