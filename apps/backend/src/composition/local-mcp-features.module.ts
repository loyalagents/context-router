import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LocalConfigurationService,
  LOCAL_APPLICATION_CONFIGURATION,
} from './local-configuration.module';
import { PreferenceModule } from '../modules/preferences/preference/preference.module';
import { PreferenceDefinitionModule } from '../modules/preferences/preference-definition/preference-definition.module';
import { PermissionGrantModule } from '../modules/permission-grant/permission-grant.module';
import { WorkflowsModule } from '../modules/workflows/workflows.module';
import { McpAccessLogModule } from '../mcp/access-log/mcp-access-log.module';
import { McpService } from '../mcp/mcp.service';
import { McpAuthorizationService } from '../mcp/auth/mcp-authorization.service';
import { mcpToolProviders } from '../mcp/mcp-tool.providers';
import { MCP_RESOURCES } from '../mcp/mcp.constants';
import { GRAPHQL_SCHEMA_SDL_SUPPLIER } from '../mcp/resources/graphql-schema-sdl';
import { SchemaResource } from '../mcp/resources/schema.resource';
import { LocalCapabilitiesResource } from '../mcp/local/local-capabilities.resource';

@Module({
  imports: [
    PreferenceModule,
    PreferenceDefinitionModule,
    PermissionGrantModule,
    WorkflowsModule,
    McpAccessLogModule,
  ],
  providers: [
    {
      provide: ConfigService,
      useFactory: () =>
        new LocalConfigurationService({
          ...LOCAL_APPLICATION_CONFIGURATION,
          mcp: {
            server: { name: 'context-router-local', version: '1.0.0' },
            tools: {
              preferences: { enabled: true, maxSearchResults: 100 },
            },
            resources: { schema: { enabled: true } },
          },
        }),
    },
    McpService,
    McpAuthorizationService,
    ...mcpToolProviders,
    {
      provide: GRAPHQL_SCHEMA_SDL_SUPPLIER,
      useFactory: () => {
        const sdl = readFileSync(join(__dirname, '../schema.gql'), 'utf8');
        return () => sdl;
      },
    },
    SchemaResource,
    LocalCapabilitiesResource,
    {
      provide: MCP_RESOURCES,
      inject: [SchemaResource, LocalCapabilitiesResource],
      useFactory: (schema, capabilities) => [schema, capabilities],
    },
  ],
  exports: [McpService],
})
export class LocalMcpFeaturesModule {}
