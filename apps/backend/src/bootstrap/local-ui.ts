import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import type { LocalDatabaseConfiguration } from '../config/local-database.config';
import type { LocalModelSelection } from '../config/local-model.config';
import {
  createSqliteIdentityRuntime,
  seedLocalCatalog,
} from '../infrastructure/storage/sqlite/sqlite-local-runtime';
import { SqliteMcpCredentials } from '../infrastructure/storage/sqlite/sqlite-mcp-credentials';
import { LocalUiApplicationModule } from '../composition/local-ui-application.module';
import { LocalUiSessions } from '../local-ui/local-ui-sessions';
import { LocalUiManagement } from '../local-ui/local-ui-management';
import { createLocalUiAiPolicy } from '../local-ui/local-ui-ai';
import { ConfigService } from '@nestjs/config';
import {
  LocalUiBoundary,
  LocalUiHttpAdapter,
  rejectUiRequest,
  type LocalUiWebHandler,
} from '../local-ui/local-ui-http';
import { configureLocalIdentityPreview } from './local-identity-preview';
import { LocalMcpHttpServer } from '../mcp/local/local-mcp-http';
import { LocalMcpAuthGuard } from '../mcp/local/local-mcp-auth.guard';
import { McpService } from '../mcp/mcp.service';
import {
  AI_TEXT_GENERATOR_PORT,
  AI_STRUCTURED_OUTPUT_PORT,
} from '../domains/shared/ports/ai.tokens';
import type { AiTextGeneratorPort } from '../domains/shared/ports/ai-text-generator.port';

export async function createLocalUiApplication(
  configuration: LocalDatabaseConfiguration,
  options: {
    port: number;
    mcpPort: number;
    exportRoot: string;
    webHandler: LocalUiWebHandler;
    model?: LocalModelSelection;
  },
) {
  for (const port of [options.port, options.mcpPort])
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error('Local UI startup failed');
  if (options.port !== 0 && options.port === options.mcpPort)
    throw new Error('Local UI startup failed');
  const identity = createSqliteIdentityRuntime(configuration);
  const ready = await identity.service.verifyReadyState();
  const credentials = new SqliteMcpCredentials(
    identity.database,
    ready.state.principalId,
  );
  credentials.list(); // Existing explicit v2 upgrade remains required.
  await seedLocalCatalog(identity.database);
  const sessions = new LocalUiSessions({
    principalId: ready.state.principalId,
    exportRoot: options.exportRoot,
    excludedRoots: [
      configuration.stateRoot,
      configuration.databaseRoot,
      ...(options.model ? [options.model.root] : []),
    ],
  });
  let application: NestExpressApplication,
    mcp: LocalMcpHttpServer,
    boundary: LocalUiBoundary,
    server: Server;
  let closing: Promise<void>;
  const close = () =>
    (closing ??= (async () => {
      boundary?.close();
      sessions.close();
      server?.closeAllConnections();
      try {
        await mcp?.close();
      } finally {
        await application?.close();
      }
    })());
  try {
    sessions.validateExportRoot();
    application = await NestFactory.create<NestExpressApplication>(
      LocalUiApplicationModule.register(configuration, sessions, options.model),
      new LocalUiHttpAdapter(),
      { logger: false, abortOnError: false, bodyParser: false },
    );
    server = application.getHttpServer();
    const ai = application.get<AiTextGeneratorPort>(AI_TEXT_GENERATOR_PORT);
    const policy = createLocalUiAiPolicy(
      ai.capabilities,
      application.get(AI_STRUCTURED_OUTPUT_PORT).capabilities,
      application.get(ConfigService),
    );
    boundary = new LocalUiBoundary(
      sessions,
      server,
      ai,
      options.webHandler,
      new LocalUiManagement(credentials, ready.state.principalId),
      policy,
    );
    application.use(boundary.middleware);
    application.useBodyParser('json', { limit: 256 * 1024 });
    application.use((error, _req, res, _next) =>
      rejectUiRequest(res, error?.type === 'entity.too.large' ? 413 : 400),
    );
    configureLocalIdentityPreview(application);
    await application.init();
    await identity.service.verifyReadyState();
    mcp = new LocalMcpHttpServer(
      application.get(McpService),
      new LocalMcpAuthGuard(credentials),
      ai.capabilities.strictExecutionControls,
    );
    await mcp.listen(options.mcpPort);
    await application.listen(options.port, '127.0.0.1');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    return {
      application,
      server,
      sessions,
      credentials,
      port: address.port,
      mcpPort: mcp.port,
      issueUnlock: () => sessions.issue(),
      close,
    };
  } catch {
    await close();
    throw new Error('Local UI startup failed');
  }
}
