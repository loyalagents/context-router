import type { FactoryProvider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GRAPHQL_SDL_FILE_HEADER, GraphQLSchemaHost } from '@nestjs/graphql';
import {
  lexicographicSortSchema,
  printSchema,
  type GraphQLSchema,
} from 'graphql';

export const GRAPHQL_SCHEMA_SDL_SUPPLIER = Symbol(
  'GRAPHQL_SCHEMA_SDL_SUPPLIER',
);

export type GraphqlSchemaSdlSupplier = () => string | Promise<string>;

export function serializeGraphqlSchema(schema: GraphQLSchema): string {
  return GRAPHQL_SDL_FILE_HEADER + printSchema(lexicographicSortSchema(schema));
}

export function createGraphqlSchemaSdlSupplier(
  moduleRef: Pick<ModuleRef, 'get'>,
): GraphqlSchemaSdlSupplier {
  return () => {
    const schemaHost = moduleRef.get(GraphQLSchemaHost, { strict: false });
    return serializeGraphqlSchema(schemaHost.schema);
  };
}

export const graphqlSchemaSdlSupplierProvider: FactoryProvider<GraphqlSchemaSdlSupplier> =
  {
    provide: GRAPHQL_SCHEMA_SDL_SUPPLIER,
    inject: [ModuleRef],
    useFactory: createGraphqlSchemaSdlSupplier,
  };
