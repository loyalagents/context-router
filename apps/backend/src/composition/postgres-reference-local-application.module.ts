import { DynamicModule, Module } from "@nestjs/common";

import type { LocalIdentityConfiguration } from "../config/local-identity.config";
import { McpAccessLogModule } from "../mcp/access-log/mcp-access-log.module";
import { LocalAuthModule } from "../modules/auth/local-auth.module";
import { ApplicationFeaturesModule } from "./application-features.module";
import { createGraphqlApiModule } from "./graphql-api.module";
import { LocalConfigurationModule } from "./local-configuration.module";
import { PostgresReferenceLocalIdentityInfrastructureModule } from "./postgres-reference-local-identity-infrastructure.module";
import { LocalModelAdapterModule } from "./local-model-adapter.module";

@Module({})
export class PostgresReferenceLocalApplicationModule {
  static register(configuration: LocalIdentityConfiguration): DynamicModule {
    return {
      module: PostgresReferenceLocalApplicationModule,
      imports: [
        LocalConfigurationModule.register(),
        createGraphqlApiModule(),
        PostgresReferenceLocalIdentityInfrastructureModule.register(
          configuration,
        ),
        LocalModelAdapterModule,
        LocalAuthModule,
        ApplicationFeaturesModule,
        McpAccessLogModule,
      ],
    };
  }
}
