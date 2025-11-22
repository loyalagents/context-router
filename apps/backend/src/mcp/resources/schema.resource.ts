import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class SchemaResource {
  private readonly logger = new Logger(SchemaResource.name);
  private schemaCache: string | null = null;
  private lastCacheTime: number = 0;
  private readonly CACHE_TTL_MS = 60000; // Cache for 1 minute

  /**
   * Get the GraphQL schema
   * Returns the auto-generated schema from src/schema.gql
   * Caches the schema for 1 minute to avoid excessive file reads
   */
  async getGraphQLSchema(): Promise<string> {
    const now = Date.now();

    // Return cached schema if still valid
    if (this.schemaCache && now - this.lastCacheTime < this.CACHE_TTL_MS) {
      this.logger.debug('Returning cached GraphQL schema');
      return this.schemaCache;
    }

    try {
      const schemaPath = join(process.cwd(), 'src', 'schema.gql');
      this.logger.log(`Reading GraphQL schema from: ${schemaPath}`);

      const schema = await readFile(schemaPath, 'utf-8');

      // Update cache
      this.schemaCache = schema;
      this.lastCacheTime = now;

      this.logger.log('GraphQL schema loaded successfully');
      return schema;
    } catch (error) {
      this.logger.error(
        `Error reading GraphQL schema: ${error.message}`,
        error.stack,
      );

      // Return cached schema if available, even if expired
      if (this.schemaCache) {
        this.logger.warn('Returning expired cached schema due to read error');
        return this.schemaCache;
      }

      throw new Error(
        'GraphQL schema not available. Ensure the application has started and schema has been generated.',
      );
    }
  }
}
