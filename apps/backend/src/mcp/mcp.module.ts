import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { PreferencesModule } from '@/modules/preferences/preferences.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { PreferenceSearchTool } from './tools/preference-search.tool';
import { PreferenceMutationTool } from './tools/preference-mutation.tool';
import { PreferenceListTool } from './tools/preference-list.tool';
import { SchemaResource } from './resources/schema.resource';
import { OAuthMetadataController } from './auth/oauth-metadata.controller';
import { DcrShimController } from './auth/dcr-shim.controller';
import { DcrRateLimitGuard } from './auth/dcr-rate-limit.guard';
import { McpAuthGuard } from './auth/mcp-auth.guard';

@Module({
  imports: [ConfigModule, PreferencesModule, AuthModule],
  controllers: [McpController, OAuthMetadataController, DcrShimController],
  providers: [
    McpService,
    PreferenceSearchTool,
    PreferenceMutationTool,
    PreferenceListTool,
    SchemaResource,
    DcrRateLimitGuard,
    McpAuthGuard,
  ],
  exports: [McpService],
})
export class McpModule {}
