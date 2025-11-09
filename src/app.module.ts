import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';

// Config
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import graphqlConfig from './config/graphql.config';

// Infrastructure
import { PrismaModule } from './infrastructure/prisma/prisma.module';

// Modules
import { UserModule } from './modules/user/user.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, graphqlConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // GraphQL
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: process.env.GRAPHQL_PLAYGROUND === 'true',
      introspection: process.env.NODE_ENV !== 'production',
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

    // Feature Modules
    UserModule,
    HealthModule,
  ],
})
export class AppModule {}
