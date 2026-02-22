import { Module } from '@nestjs/common';
import { LocationModule } from './location/location.module';
import { PreferenceModule } from './preference/preference.module';
import { DocumentAnalysisModule } from './document-analysis/document-analysis.module';
import { PreferenceDefinitionModule } from './preference-definition/preference-definition.module';

@Module({
  imports: [LocationModule, PreferenceModule, DocumentAnalysisModule, PreferenceDefinitionModule],
  exports: [LocationModule, PreferenceModule, DocumentAnalysisModule, PreferenceDefinitionModule],
})
export class PreferencesModule {}
