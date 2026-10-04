import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { LocalDatabaseConfiguration } from '../config/local-database.config';
import type { LocalModelSelection } from '../config/local-model.config';
import { LocalMcpApplicationModule } from '../composition/local-mcp-application.module';
import {
  createSqliteIdentityRuntime,
  seedLocalCatalog,
} from '../infrastructure/storage/sqlite/sqlite-local-runtime';
import { SqliteMcpCredentials } from '../infrastructure/storage/sqlite/sqlite-mcp-credentials';
import { McpService } from '../mcp/mcp.service';
import { LocalMcpAuthGuard } from '../mcp/local/local-mcp-auth.guard';
import { LocalMcpHttpServer } from '../mcp/local/local-mcp-http';
import { AI_TEXT_GENERATOR_PORT } from '../domains/shared/ports/ai.tokens';
import type { AiTextGeneratorPort } from '../domains/shared/ports/ai-text-generator.port';

export async function createLocalMcpApplication(
  configuration: LocalDatabaseConfiguration,
  options: { port: number; model?: LocalModelSelection },
) {
  const identity = createSqliteIdentityRuntime(configuration);
  const ready = await identity.service.verifyReadyState();
  const credentials = new SqliteMcpCredentials(
    identity.database,
    ready.state.principalId,
  );
  credentials.list(); // Explicit upgrade required; ordinary start never changes schema.
  await seedLocalCatalog(identity.database);
  let application: INestApplicationContext, http: LocalMcpHttpServer;
  try {
    application = await NestFactory.createApplicationContext(
      LocalMcpApplicationModule.register(configuration, options.model),
      { logger: false, abortOnError: false },
    );
    await identity.service.verifyReadyState();
    http = new LocalMcpHttpServer(
      application.get(McpService),
      new LocalMcpAuthGuard(credentials),
      application.get<AiTextGeneratorPort>(
        AI_TEXT_GENERATOR_PORT,
      ).capabilities.strictExecutionControls,
    );
    await http.listen(options.port);
  } catch {
    if (http) await http.close();
    if (application) await application.close();
    throw new Error('Local MCP startup failed');
  }
  let closing: Promise<void>;
  return {
    application,
    http,
    port: http.port,
    close: () =>
      (closing ??= (async () => {
        await http.close();
        await application.close(); // Includes independent model settlement and owned parser cleanup.
      })()),
  };
}
