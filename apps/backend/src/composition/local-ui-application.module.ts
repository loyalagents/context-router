import { DynamicModule, Module } from '@nestjs/common';
import type { LocalDatabaseConfiguration } from '../config/local-database.config';
import type { LocalModelSelection } from '../config/local-model.config';
import { LocalConfigurationModule } from './local-configuration.module';
import { LocalIdentityInfrastructureModule } from './local-identity-infrastructure.module';
import { LocalConfiguredModelModule } from './local-configured-model.module';
import { LocalModelAdapterModule } from './local-model-adapter.module';
import { LocalMcpFeaturesModule } from './local-mcp-features.module';
import { ApplicationFeaturesModule } from './application-features.module';
import { createGraphqlApiModule } from './graphql-api.module';
import { LocalUiAuthModule } from '../local-ui/local-ui-auth.module';
import { LocalUiSessions } from '../local-ui/local-ui-sessions';

@Module({})
export class LocalUiApplicationModule {
  static register(
    configuration: LocalDatabaseConfiguration,
    sessions: LocalUiSessions,
    model?: LocalModelSelection,
  ): DynamicModule {
    return {
      module: LocalUiApplicationModule,
      imports: [
        LocalConfigurationModule.register(),
        LocalIdentityInfrastructureModule.register(configuration),
        model
          ? LocalConfiguredModelModule.register({
              root: model.root,
              port: model.port,
              identityRoot: configuration.stateRoot,
              databaseRoot: configuration.databaseRoot,
            })
          : LocalModelAdapterModule,
        createGraphqlApiModule(),
        LocalUiAuthModule.register(sessions),
        ApplicationFeaturesModule,
        LocalMcpFeaturesModule,
      ],
    };
  }
}
