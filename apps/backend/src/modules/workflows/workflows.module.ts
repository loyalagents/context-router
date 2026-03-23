import { Module } from '@nestjs/common';
import { VertexAiModule } from '../vertex-ai/vertex-ai.module';
import { PreferenceDefinitionModule } from '../preferences/preference-definition/preference-definition.module';
import { PreferenceModule } from '../preferences/preference/preference.module';
import { PreferenceSearchWorkflow } from './preferences/preference-search/preference-search.workflow';
import { SchemaConsolidationWorkflow } from './preferences/schema-consolidation/schema-consolidation.workflow';

@Module({
  imports: [VertexAiModule, PreferenceDefinitionModule, PreferenceModule],
  providers: [PreferenceSearchWorkflow, SchemaConsolidationWorkflow],
  exports: [PreferenceSearchWorkflow, SchemaConsolidationWorkflow],
})
export class WorkflowsModule {}
