import { Module } from '@nestjs/common';
import { DocumentAnalysisController } from './document-analysis.controller';
import { DocumentAnalysisService } from './document-analysis.service';
import { DocumentAnalysisResolver } from './document-analysis.resolver';
import { PreferenceExtractionService } from './preference-extraction.service';
import { PreferenceModule } from '../preference/preference.module';
import { VertexAiModule } from '../../vertex-ai/vertex-ai.module';

@Module({
  imports: [PreferenceModule, VertexAiModule],
  controllers: [DocumentAnalysisController],
  providers: [
    DocumentAnalysisService,
    DocumentAnalysisResolver,
    PreferenceExtractionService,
  ],
  exports: [DocumentAnalysisService],
})
export class DocumentAnalysisModule {}
