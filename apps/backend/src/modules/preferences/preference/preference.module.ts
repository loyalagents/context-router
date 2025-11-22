import { Module } from '@nestjs/common';
import { PreferenceService } from './preference.service';
import { PreferenceRepository } from './preference.repository';
import { PreferenceResolver } from './preference.resolver';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { LocationModule } from '../location/location.module';

@Module({
  imports: [PrismaModule, LocationModule],
  providers: [PreferenceService, PreferenceRepository, PreferenceResolver],
  exports: [PreferenceService],
})
export class PreferenceModule {}
