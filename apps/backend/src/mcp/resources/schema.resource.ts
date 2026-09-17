import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resource } from '@modelcontextprotocol/sdk/types.js';
import { McpResourceInterface } from './base/mcp-resource.interface';
import { McpContext } from '../types/mcp-context.type';
import { McpResourceExecutionResult } from '../access-log/access-log.types';
import {
  GRAPHQL_SCHEMA_SDL_SUPPLIER,
  type GraphqlSchemaSdlSupplier,
} from './graphql-schema-sdl';

export const SCHEMA_RESOURCE_UNAVAILABLE_MESSAGE =
  'GraphQL schema is unavailable';

@Injectable()
export class SchemaResource implements McpResourceInterface {
  private readonly logger = new Logger(SchemaResource.name);
  private schemaCache: string | null = null;
  private lastCacheTime: number = 0;
  private readonly CACHE_TTL_MS = 60000; // Cache for 1 minute

  constructor(
    @Inject(GRAPHQL_SCHEMA_SDL_SUPPLIER)
    private readonly schemaSupplier: GraphqlSchemaSdlSupplier,
  ) {}

  readonly descriptor: Resource = {
    uri: 'schema://graphql',
    name: 'GraphQL Schema',
    description:
      'GraphQL schema for the Context Router API. Use this for API introspection and direct GraphQL integration, not for preference lookup; use searchPreferences or smartSearchPreferences for preference retrieval.',
    mimeType: 'text/plain',
  };

  readonly requiredAccess = {
    resource: 'preferences',
    action: 'read',
  } as const;

  /**
   * Get the GraphQL schema
   * Returns the schema owned by the initialized GraphQL runtime.
   * Caches successful serialization for 1 minute.
   */
  async getGraphQLSchema(): Promise<{ schema: string; cacheHit: boolean }> {
    const now = Date.now();

    // Return cached schema if still valid
    if (
      this.schemaCache !== null &&
      now - this.lastCacheTime < this.CACHE_TTL_MS
    ) {
      this.logger.debug('Returning cached GraphQL schema');
      return { schema: this.schemaCache, cacheHit: true };
    }

    try {
      const schema = await this.schemaSupplier();

      // Update cache
      this.schemaCache = schema;
      this.lastCacheTime = now;

      this.logger.log('GraphQL schema loaded successfully');
      return { schema, cacheHit: false };
    } catch {
      this.logger.error(SCHEMA_RESOURCE_UNAVAILABLE_MESSAGE);
      throw new Error(SCHEMA_RESOURCE_UNAVAILABLE_MESSAGE);
    }
  }

  async read(_context: McpContext): Promise<McpResourceExecutionResult> {
    const { schema: schemaContent, cacheHit } = await this.getGraphQLSchema();
    return {
      result: {
        contents: [
          {
            uri: this.descriptor.uri,
            mimeType: this.descriptor.mimeType,
            text: schemaContent,
          },
        ],
      },
      accessLog: {
        requestMetadata: {
          uri: this.descriptor.uri,
        },
        responseMetadata: {
          byteLength: Buffer.byteLength(schemaContent, 'utf8'),
          cacheHit,
        },
      },
    };
  }
}
