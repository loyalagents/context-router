import { Module } from '@nestjs/common';
import { PreferenceService } from './preference.service';
import { PreferenceRepository } from './preference.repository';
import { PreferenceResolver } from './preference.resolver';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { LocationModule } from '../location/location.module';
import { PreferenceDefinitionModule } from '../preference-definition/preference-definition.module';
import { PreferenceAuditModule } from '../audit/preference-audit.module';

@Module({
  imports: [
    PrismaModule,
    LocationModule,
    PreferenceDefinitionModule,
    PreferenceAuditModule,
  ],
  providers: [PreferenceService, PreferenceRepository, PreferenceResolver],
  exports: [PreferenceService],
})
export class PreferenceModule {}
