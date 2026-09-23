import { registerAs } from '@nestjs/config';

export interface GraphqlConfiguration {
  playground: boolean;
  debug: boolean;
  introspection: boolean;
}

export function createGraphqlConfiguration(
  environment: NodeJS.ProcessEnv,
): GraphqlConfiguration {
  return {
    playground: environment.GRAPHQL_PLAYGROUND === 'true',
    debug: environment.GRAPHQL_DEBUG === 'true',
    introspection: environment.NODE_ENV !== 'production',
  };
}

export function graphqlConfigLoader(environment: NodeJS.ProcessEnv) {
  return registerAs('graphql', () => createGraphqlConfiguration(environment));
}
