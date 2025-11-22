import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { PreferencesModule } from '@/modules/preferences/preferences.module';
import { PreferenceSearchTool } from './tools/preference-search.tool';
import { PreferenceMutationTool } from './tools/preference-mutation.tool';
import { SchemaResource } from './resources/schema.resource';

@Module({
  imports: [ConfigModule, PreferencesModule],
  controllers: [McpController],
  providers: [
    McpService,
    PreferenceSearchTool,
    PreferenceMutationTool,
    SchemaResource,
  ],
  exports: [McpService],
})
export class McpModule {}
