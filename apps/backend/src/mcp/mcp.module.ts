import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { PreferencesModule } from '@/modules/preferences/preferences.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { WorkflowsModule } from '@/modules/workflows/workflows.module';
import { PreferenceSearchTool } from './tools/preference-search.tool';
import { PreferenceMutationTool } from './tools/preference-mutation.tool';
import { PreferenceListTool } from './tools/preference-list.tool';
import { PreferenceDefinitionTool } from './tools/preference-definition.tool';
import { PreferenceSuggestTool } from './tools/preference-suggest.tool';
import { PreferenceDeleteTool } from './tools/preference-delete.tool';
import { SmartSearchTool } from './tools/smart-search.tool';
import { SchemaConsolidationTool } from './tools/schema-consolidation.tool';
import { SchemaResource } from './resources/schema.resource';
import { OAuthMetadataController } from './auth/oauth-metadata.controller';
import { DcrShimController } from './auth/dcr-shim.controller';
import { DcrRateLimitGuard } from './auth/dcr-rate-limit.guard';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { McpClientRegistry } from './auth/mcp-client-registry.service';
import { McpAuthorizationService } from './auth/mcp-authorization.service';
import { McpOriginMiddleware } from './middleware/mcp-origin.middleware';
import { MCP_RESOURCES, MCP_TOOLS } from './mcp.constants';

@Module({
  imports: [ConfigModule, PreferencesModule, AuthModule, WorkflowsModule],
  controllers: [McpController, OAuthMetadataController, DcrShimController],
  providers: [
    McpService,
    // Shared provider (not registered as an MCP tool)
    PreferenceMutationTool,
    // Tool classes
    PreferenceListTool,
    PreferenceSearchTool,
    PreferenceDefinitionTool,
    PreferenceSuggestTool,
    PreferenceDeleteTool,
    SmartSearchTool,
    SchemaConsolidationTool,
    // MCP_TOOLS token — collects all McpToolInterface implementations
    {
      provide: MCP_TOOLS,
      useFactory: (
        list: PreferenceListTool,
        search: PreferenceSearchTool,
        definition: PreferenceDefinitionTool,
        suggest: PreferenceSuggestTool,
        del: PreferenceDeleteTool,
        smartSearch: SmartSearchTool,
        consolidation: SchemaConsolidationTool,
      ) => [list, search, definition, suggest, del, smartSearch, consolidation],
      inject: [
        PreferenceListTool,
        PreferenceSearchTool,
        PreferenceDefinitionTool,
        PreferenceSuggestTool,
        PreferenceDeleteTool,
        SmartSearchTool,
        SchemaConsolidationTool,
      ],
    },
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
