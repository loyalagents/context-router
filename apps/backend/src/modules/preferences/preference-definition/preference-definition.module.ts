import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PreferenceDefinitionResolver } from './preference-definition.resolver';
import { PreferenceDefinitionService } from './preference-definition.service';
import { OptionalGqlAuthGuard } from '@common/guards/optional-gql-auth.guard';
import { PreferenceSchemaSnapshotService } from './preference-schema-snapshot.service';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [
    PreferenceDefinitionRepository,
    PreferenceDefinitionResolver,
    PreferenceDefinitionService,
    OptionalGqlAuthGuard,
    PreferenceSchemaSnapshotService,
  ],
  exports: [
    PreferenceDefinitionRepository,
    PreferenceDefinitionService,
    PreferenceSchemaSnapshotService,
  ],
})
export class PreferenceDefinitionModule {}
