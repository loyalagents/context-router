import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { PreferencesModule } from '@/modules/preferences/preferences.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { WorkflowsModule } from '@/modules/workflows/workflows.module';
import { PermissionGrantModule } from '@/modules/permission-grant/permission-grant.module';
import { SchemaResource } from './resources/schema.resource';
import { McpAccessLogModule } from './access-log/mcp-access-log.module';
import { OAuthMetadataController } from './auth/oauth-metadata.controller';
import { DcrShimController } from './auth/dcr-shim.controller';
import { DcrRateLimitGuard } from './auth/dcr-rate-limit.guard';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { McpClientRegistry } from './auth/mcp-client-registry.service';
import { McpAuthorizationService } from './auth/mcp-authorization.service';
import { McpOriginMiddleware } from './middleware/mcp-origin.middleware';
import { MCP_RESOURCES } from './mcp.constants';
import { mcpToolProviders } from './mcp-tool.providers';
import { graphqlSchemaSdlSupplierProvider } from './resources/graphql-schema-sdl';

@Module({
  imports: [
    ConfigModule,
    PreferencesModule,
    PermissionGrantModule,
    AuthModule,
    WorkflowsModule,
    McpAccessLogModule,
  ],
  controllers: [McpController, OAuthMetadataController, DcrShimController],
  providers: [
    McpService,
    ...mcpToolProviders,
    graphqlSchemaSdlSupplierProvider,
    SchemaResource,
    DcrRateLimitGuard,
    McpAuthGuard,
    McpClientRegistry,
    McpAuthorizationService,
    McpOriginMiddleware,
    {
      provide: MCP_RESOURCES,
      useFactory: (schema: SchemaResource) => [schema],
      inject: [SchemaResource],
    },
  ],
  exports: [McpService],
})
export class McpModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(McpOriginMiddleware).forRoutes('/mcp');
  }
}
