import { DynamicModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { GraphQLModule } from "@nestjs/graphql";

export function createGraphqlApiModule(): DynamicModule {
  return GraphQLModule.forRootAsync<ApolloDriverConfig>({
    driver: ApolloDriver,
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => ({
      autoSchemaFile: true,
      sortSchema: true,
      playground: configService.get<boolean>("graphql.playground"),
      introspection: configService.get<boolean>("graphql.introspection"),
      context: ({ req }) => ({ req }),
      formatError: (error) => ({
        message: error.message,
        extensions: {
          code: error.extensions?.code,
          stacktrace: configService.get<boolean>("app.isDevelopment")
            ? error.extensions?.stacktrace
            : undefined,
        },
      }),
    }),
  });
}
