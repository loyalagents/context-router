import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PreferenceDefinitionResolver } from './preference-definition.resolver';
import { PreferenceDefinitionService } from './preference-definition.service';

@Module({
  imports: [PrismaModule],
  providers: [
    PreferenceDefinitionRepository,
    PreferenceDefinitionResolver,
    PreferenceDefinitionService,
  ],
  exports: [PreferenceDefinitionRepository],
})
export class PreferenceDefinitionModule {}
