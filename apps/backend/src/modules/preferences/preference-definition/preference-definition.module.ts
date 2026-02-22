import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PreferenceDefinitionResolver } from './preference-definition.resolver';

@Module({
  imports: [PrismaModule],
  providers: [PreferenceDefinitionRepository, PreferenceDefinitionResolver],
  exports: [PreferenceDefinitionRepository],
})
export class PreferenceDefinitionModule {}
