import { Logger, Module } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import { buildSchema } from 'graphql';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GRAPHQL_SCHEMA_SDL_SUPPLIER,
  createGraphqlSchemaSdlSupplier,
  graphqlSchemaSdlSupplierProvider,
  serializeGraphqlSchema,
} from './graphql-schema-sdl';
import {
  SCHEMA_RESOURCE_UNAVAILABLE_MESSAGE,
  SchemaResource,
} from './schema.resource';

const schemaFixture = readFileSync(
  join(__dirname, '..', '..', 'schema.gql'),
  'utf8',
);

describe('GraphQL schema resource', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serializes the canonical schema byte-for-byte like the tracked fixture', () => {
    const serialized = serializeGraphqlSchema(buildSchema(schemaFixture));

    expect(serialized).toBe(schemaFixture);
    expect(Buffer.byteLength(serialized, 'utf8')).toBe(14088);
    expect(serialized.endsWith('\n')).toBe(false);
  });

  it('defers the non-strict application schema lookup until the supplier runs', async () => {
    const host = new GraphQLSchemaHost();
    host.schema = buildSchema(schemaFixture);
    const moduleRef = {
      get: jest.fn().mockReturnValue(host),
    };

    const supplier = createGraphqlSchemaSdlSupplier(moduleRef as never);

    expect(moduleRef.get).not.toHaveBeenCalled();
    await expect(Promise.resolve(supplier())).resolves.toBe(schemaFixture);
    expect(moduleRef.get).toHaveBeenCalledWith(GraphQLSchemaHost, {
      strict: false,
    });
  });

  it('resolves the schema host across sibling Nest modules', async () => {
    const host = new GraphQLSchemaHost();
    host.schema = buildSchema(schemaFixture);

    @Module({
      providers: [{ provide: GraphQLSchemaHost, useValue: host }],
      exports: [GraphQLSchemaHost],
    })
    class GraphqlSiblingModule {}

    @Module({
      providers: [graphqlSchemaSdlSupplierProvider],
      exports: [GRAPHQL_SCHEMA_SDL_SUPPLIER],
    })
    class ResourceSiblingModule {}

    const testingModule = await Test.createTestingModule({
      imports: [GraphqlSiblingModule, ResourceSiblingModule],
    }).compile();

    try {
      const supplier = testingModule.get<() => Promise<string> | string>(
        GRAPHQL_SCHEMA_SDL_SUPPLIER,
      );
      await expect(Promise.resolve(supplier())).resolves.toBe(schemaFixture);
    } finally {
      await testingModule.close();
    }
  });

  it('uses a short-lived successful cache but never serves stale schema after failure', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const supplier = jest
      .fn<Promise<string>, []>()
      .mockResolvedValueOnce(schemaFixture)
      .mockRejectedValueOnce(
        new Error('/private/secret/schema.gql supplier-secret-canary'),
      );
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const resource = new SchemaResource(supplier);

    await expect(resource.getGraphQLSchema()).resolves.toEqual({
      schema: schemaFixture,
      cacheHit: false,
    });
    await expect(resource.getGraphQLSchema()).resolves.toEqual({
      schema: schemaFixture,
      cacheHit: true,
    });
    expect(supplier).toHaveBeenCalledTimes(1);

    now += 60_001;
    await expect(resource.getGraphQLSchema()).rejects.toThrow(
      SCHEMA_RESOURCE_UNAVAILABLE_MESSAGE,
    );
    expect(supplier).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.mock.calls)).toBe(
      JSON.stringify([[SCHEMA_RESOURCE_UNAVAILABLE_MESSAGE]]),
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      'supplier-secret-canary',
    );
  });

  it('preserves the public descriptor, exact text, byte length, and cache metadata', async () => {
    const resource = new SchemaResource(async () => 'schema-✓');

    await expect(resource.read({} as never)).resolves.toEqual({
      result: {
        contents: [
          {
            uri: 'schema://graphql',
            mimeType: 'text/plain',
            text: 'schema-✓',
          },
        ],
      },
      accessLog: {
        requestMetadata: { uri: 'schema://graphql' },
        responseMetadata: {
          byteLength: Buffer.byteLength('schema-✓', 'utf8'),
          cacheHit: false,
        },
      },
    });
  });
});
