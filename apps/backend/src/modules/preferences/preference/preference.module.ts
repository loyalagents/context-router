import { Module } from '@nestjs/common';
import { PreferenceService } from './preference.service';
import { PreferenceResolver } from './preference.resolver';
import { LocationModule } from '../location/location.module';
import { PreferenceDefinitionModule } from '../preference-definition/preference-definition.module';
import { PreferenceAuditModule } from '../audit/preference-audit.module';

@Module({
  imports: [
    LocationModule,
    PreferenceDefinitionModule,
    PreferenceAuditModule,
  ],
  providers: [PreferenceService, PreferenceResolver],
  exports: [PreferenceService],
})
export class PreferenceModule {}
