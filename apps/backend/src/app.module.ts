import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';

// Config
import { appConfigLoader } from './config/app.config';
import graphqlConfig from './config/graphql.config';
import authConfig from './config/auth.config';
import { mcpConfigLoader } from './config/mcp.config';
import documentUploadConfig from './config/document-upload.config';
import formFillConfig from './config/form-fill.config';
import {
  runtimeConfigLoader,
  type RuntimeConfiguration,
} from './config/runtime-config';

// Infrastructure
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { Auth0Module } from './infrastructure/auth0/auth0.module';
import { HostedModelAdapterModule } from './composition/hosted-model-adapter.module';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { HealthModule } from './modules/health/health.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { PermissionGrantModule } from './modules/permission-grant/permission-grant.module';
import { McpModule } from './mcp/mcp.module';
import { VertexAiModule } from './modules/vertex-ai/vertex-ai.module';
import { ResetModule } from './modules/reset/reset.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';

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
            graphqlConfig,
            authConfig,
            mcpConfigLoader(configuration),
            documentUploadConfig,
            formFillConfig,
          ],
        }),

        GraphQLModule.forRootAsync<ApolloDriverConfig>({
          driver: ApolloDriver,
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            autoSchemaFile: true,
            sortSchema: true,
            playground: configService.get<boolean>('graphql.playground'),
            introspection: configService.get<boolean>('graphql.introspection'),
            context: ({ req }) => ({ req }),
            formatError: (error) => ({
              message: error.message,
              extensions: {
                code: error.extensions?.code,
                stacktrace: configService.get<boolean>('app.isDevelopment')
                  ? error.extensions?.stacktrace
                  : undefined,
              },
            }),
          }),
        }),

        PrismaModule,
        Auth0Module,
        HostedModelAdapterModule,

        AuthModule,
        UserModule,
        HealthModule,
        PreferencesModule,
        PermissionGrantModule,
        McpModule,
        VertexAiModule,
        WorkflowsModule,
        ResetModule,
      ],
    };
  }
}
