import type { LocalModelSelection } from '../config/local-model.config';
import { LocalConfiguredModelModule } from './local-configured-model.module';
import { DynamicModule, Module } from "@nestjs/common";

import type { LocalDatabaseConfiguration } from "../config/local-database.config";
import { McpAccessLogModule } from "../mcp/access-log/mcp-access-log.module";
import { LocalAuthModule } from "../modules/auth/local-auth.module";
import { ApplicationFeaturesModule } from "./application-features.module";
import { createGraphqlApiModule } from "./graphql-api.module";
import { LocalConfigurationModule } from "./local-configuration.module";
import { LocalIdentityInfrastructureModule } from "./local-identity-infrastructure.module";
import { LocalModelAdapterModule } from "./local-model-adapter.module";

@Module({})
export class LocalApplicationModule {
  static register(configuration: LocalDatabaseConfiguration, model?: LocalModelSelection): DynamicModule {
    return {
      module: LocalApplicationModule,
      imports: [
        LocalConfigurationModule.register(),
        createGraphqlApiModule(),
        LocalIdentityInfrastructureModule.register(configuration),
        model ? LocalConfiguredModelModule.register({
          root: model.root, port: model.port,
          identityRoot: configuration.stateRoot, databaseRoot: configuration.databaseRoot,
        }) : LocalModelAdapterModule,
        LocalAuthModule,
        ApplicationFeaturesModule,
        McpAccessLogModule,
      ],
    };
  }
}
