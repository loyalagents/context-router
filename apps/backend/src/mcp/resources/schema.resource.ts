import { Injectable, Logger } from '@nestjs/common';
import {
  Resource,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { McpResourceInterface } from './base/mcp-resource.interface';
import { McpContext } from '../types/mcp-context.type';
import { McpResourceExecutionResult } from '../access-log/access-log.types';

@Injectable()
export class SchemaResource implements McpResourceInterface {
  private readonly logger = new Logger(SchemaResource.name);
  private schemaCache: string | null = null;
  private lastCacheTime: number = 0;
  private readonly CACHE_TTL_MS = 60000; // Cache for 1 minute

  readonly descriptor: Resource = {
    uri: 'schema://graphql',
    name: 'GraphQL Schema',
    description:
      'The GraphQL schema for the Context Router API, showing available types, queries, and mutations.',
    mimeType: 'text/plain',
  };

  readonly requiredAccess = {
    resource: 'preferences',
    action: 'read',
  } as const;

  /**
   * Get the GraphQL schema
   * Returns the auto-generated schema from src/schema.gql
   * Caches the schema for 1 minute to avoid excessive file reads
   */
  async getGraphQLSchema(): Promise<{ schema: string; cacheHit: boolean }> {
    const now = Date.now();

    // Return cached schema if still valid
    if (this.schemaCache && now - this.lastCacheTime < this.CACHE_TTL_MS) {
      this.logger.debug('Returning cached GraphQL schema');
      return { schema: this.schemaCache, cacheHit: true };
    }

    try {
      const schemaPath = join(process.cwd(), 'src', 'schema.gql');
      this.logger.log(`Reading GraphQL schema from: ${schemaPath}`);

      const schema = await readFile(schemaPath, 'utf-8');

      // Update cache
      this.schemaCache = schema;
      this.lastCacheTime = now;

      this.logger.log('GraphQL schema loaded successfully');
      return { schema, cacheHit: false };
    } catch (error) {
      this.logger.error(
        `Error reading GraphQL schema: ${error.message}`,
        error.stack,
      );

      // Return cached schema if available, even if expired
      if (this.schemaCache) {
        this.logger.warn('Returning expired cached schema due to read error');
        return { schema: this.schemaCache, cacheHit: true };
      }

      throw new Error(
        'GraphQL schema not available. Ensure the application has started and schema has been generated.',
      );
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
