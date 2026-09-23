import { Module } from '@nestjs/common';
import { PermissionGrantModule } from '@modules/permission-grant/permission-grant.module';
import { PreferenceAuditModule } from '../audit/preference-audit.module';
import { PreferenceDefinitionResolver } from './preference-definition.resolver';
import { PreferenceDefinitionService } from './preference-definition.service';
import { PreferenceSchemaSnapshotService } from './preference-schema-snapshot.service';

@Module({
  imports: [PermissionGrantModule, PreferenceAuditModule],
  providers: [
    PreferenceDefinitionResolver,
    PreferenceDefinitionService,
    PreferenceSchemaSnapshotService,
  ],
  exports: [
    PreferenceDefinitionService,
    PreferenceSchemaSnapshotService,
  ],
})
export class PreferenceDefinitionModule {}
