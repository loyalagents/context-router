import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';

// Config
import appConfig from './config/app.config';
import graphqlConfig from './config/graphql.config';
import authConfig from './config/auth.config';
import mcpConfig from './config/mcp.config';

// Infrastructure
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { Auth0Module } from './infrastructure/auth0/auth0.module';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { HealthModule } from './modules/health/health.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, graphqlConfig, authConfig, mcpConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // GraphQL
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: process.env.GRAPHQL_PLAYGROUND === 'true',
      introspection: process.env.NODE_ENV !== 'production',
      context: ({ req }) => ({ req }),
      formatError: (error) => {
        return {
          message: error.message,
          extensions: {
            code: error.extensions?.code,
            stacktrace:
              process.env.NODE_ENV === 'development'
                ? error.extensions?.stacktrace
                : undefined,
          },
        };
      },
    }),

    // Infrastructure
    PrismaModule,
    Auth0Module,

    // Feature Modules
    AuthModule,
    UserModule,
    HealthModule,
    PreferencesModule,
    McpModule,
  ],
})
export class AppModule {}
