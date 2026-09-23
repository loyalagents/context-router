import { Module } from "@nestjs/common";

import { HealthModule } from "../modules/health/health.module";
import { PermissionGrantModule } from "../modules/permission-grant/permission-grant.module";
import { PreferencesModule } from "../modules/preferences/preferences.module";
import { ResetModule } from "../modules/reset/reset.module";
import { UserModule } from "../modules/user/user.module";
import { VertexAiModule } from "../modules/vertex-ai/vertex-ai.module";
import { WorkflowsModule } from "../modules/workflows/workflows.module";

const APPLICATION_FEATURES = [
  UserModule,
  HealthModule,
  PreferencesModule,
  PermissionGrantModule,
  VertexAiModule,
  WorkflowsModule,
  ResetModule,
] as const;

@Module({
  imports: [...APPLICATION_FEATURES],
  exports: [...APPLICATION_FEATURES],
})
export class ApplicationFeaturesModule {}
