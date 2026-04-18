import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { PermissionGrantModule } from '@modules/permission-grant/permission-grant.module';
import { PreferenceAuditModule } from '../audit/preference-audit.module';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PreferenceDefinitionResolver } from './preference-definition.resolver';
import { PreferenceDefinitionService } from './preference-definition.service';
import { PreferenceSchemaSnapshotService } from './preference-schema-snapshot.service';

@Module({
  imports: [PrismaModule, PermissionGrantModule, PreferenceAuditModule],
  providers: [
    PreferenceDefinitionRepository,
    PreferenceDefinitionResolver,
    PreferenceDefinitionService,
    PreferenceSchemaSnapshotService,
  ],
  exports: [
    PreferenceDefinitionRepository,
    PreferenceDefinitionService,
    PreferenceSchemaSnapshotService,
  ],
})
export class PreferenceDefinitionModule {}
