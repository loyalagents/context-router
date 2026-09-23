import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Config
import { appConfigLoader } from './config/app.config';
import { graphqlConfigLoader } from './config/graphql.config';
import { authConfigLoader } from './config/auth.config';
import { mcpConfigLoader } from './config/mcp.config';
import { documentUploadConfigLoader } from './config/document-upload.config';
import { formFillConfigLoader } from './config/form-fill.config';
import {
  runtimeConfigLoader,
  type RuntimeConfiguration,
} from './config/runtime-config';

// Infrastructure
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { HostedModelAdapterModule } from './composition/hosted-model-adapter.module';
import { ApplicationFeaturesModule } from './composition/application-features.module';
import { createGraphqlApiModule } from './composition/graphql-api.module';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { McpModule } from './mcp/mcp.module';

@Module({})
export class AppModule {
  static register(
    configuration: RuntimeConfiguration,
    environment: NodeJS.ProcessEnv,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            runtimeConfigLoader(configuration),
            appConfigLoader(configuration, environment),
            graphqlConfigLoader(environment),
            authConfigLoader(environment),
            mcpConfigLoader(configuration, environment),
            documentUploadConfigLoader(environment),
            formFillConfigLoader(environment),
          ],
        }),

        createGraphqlApiModule(),

        PrismaModule.registerHosted(),
        HostedModelAdapterModule,

        AuthModule,
        ApplicationFeaturesModule,
        McpModule,
      ],
    };
  }
}
