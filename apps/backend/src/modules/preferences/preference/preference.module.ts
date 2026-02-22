import { Module } from '@nestjs/common';
import { PreferenceService } from './preference.service';
import { PreferenceRepository } from './preference.repository';
import { PreferenceResolver } from './preference.resolver';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { LocationModule } from '../location/location.module';
import { PreferenceDefinitionModule } from '../preference-definition/preference-definition.module';

@Module({
  imports: [PrismaModule, LocationModule, PreferenceDefinitionModule],
  providers: [PreferenceService, PreferenceRepository, PreferenceResolver],
  exports: [PreferenceService],
})
export class PreferenceModule {}
