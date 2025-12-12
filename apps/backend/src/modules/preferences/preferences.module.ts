import { Module } from '@nestjs/common';
import { LocationModule } from './location/location.module';
import { PreferenceModule } from './preference/preference.module';
import { DocumentAnalysisModule } from './document-analysis/document-analysis.module';

@Module({
  imports: [LocationModule, PreferenceModule, DocumentAnalysisModule],
  exports: [LocationModule, PreferenceModule, DocumentAnalysisModule],
})
export class PreferencesModule {}
