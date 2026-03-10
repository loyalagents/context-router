import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { McpService } from "./mcp.service";
import { McpController } from "./mcp.controller";
import { PreferencesModule } from "@/modules/preferences/preferences.module";
import { PreferenceSearchTool } from "./tools/preference-search.tool";
import { PreferenceMutationTool } from "./tools/preference-mutation.tool";
import { PreferenceListTool } from "./tools/preference-list.tool";
import { PreferenceDefinitionTool } from "./tools/preference-definition.tool";
import { SchemaResource } from "./resources/schema.resource";
import { McpOriginMiddleware } from "./middleware/mcp-origin.middleware";
import { McpAuthGuard } from "./auth/mcp-auth.guard";

@Module({
  imports: [ConfigModule, PreferencesModule],
  controllers: [McpController],
  providers: [
    McpService,
    PreferenceSearchTool,
    PreferenceMutationTool,
    PreferenceListTool,
    PreferenceDefinitionTool,
    SchemaResource,
    McpAuthGuard,
    McpOriginMiddleware,
  ],
  exports: [McpService],
})
export class McpModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(McpOriginMiddleware).forRoutes("/mcp");
  }
}
