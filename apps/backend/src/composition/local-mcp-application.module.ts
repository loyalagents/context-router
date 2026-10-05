import { DynamicModule, Module } from '@nestjs/common';
import type { LocalDatabaseConfiguration } from '../config/local-database.config';
import type { LocalModelSelection } from '../config/local-model.config';
import { LocalConfigurationModule } from './local-configuration.module';
import { LocalIdentityInfrastructureModule } from './local-identity-infrastructure.module';
import { LocalConfiguredModelModule } from './local-configured-model.module';
import { LocalModelAdapterModule } from './local-model-adapter.module';
import { LocalAuthModule } from '../modules/auth/local-auth.module';
import { LocalMcpFeaturesModule } from './local-mcp-features.module';

/** Application context only; infrastructure and model ownership are registered once. */
@Module({})
export class LocalMcpApplicationModule {
  static register(configuration: LocalDatabaseConfiguration, model?: LocalModelSelection): DynamicModule {
    return {
      module: LocalMcpApplicationModule,
      imports: [
        LocalConfigurationModule.register(),
        LocalIdentityInfrastructureModule.register(configuration),
        model ? LocalConfiguredModelModule.register({
          root: model.root, port: model.port,
          identityRoot: configuration.stateRoot, databaseRoot: configuration.databaseRoot,
        }) : LocalModelAdapterModule,
        LocalAuthModule,
        LocalMcpFeaturesModule,
      ],
    };
  }
}
