import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";

import { GqlAuthGuard } from "../../common/guards/gql-auth.guard";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { OptionalGqlAuthGuard } from "../../common/guards/optional-gql-auth.guard";
import { HUMAN_AUTH_STRATEGY } from "../../domains/shared/ports/human-auth.constants";
import { UserModule } from "../user/user.module";
import { AuthResolver } from "./auth.resolver";
import { LocalIdentityStrategy } from "./strategies/local-identity.strategy";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: HUMAN_AUTH_STRATEGY }),
    UserModule,
  ],
  providers: [
    LocalIdentityStrategy,
    AuthResolver,
    GqlAuthGuard,
    JwtAuthGuard,
    OptionalGqlAuthGuard,
  ],
  exports: [GqlAuthGuard, JwtAuthGuard, OptionalGqlAuthGuard],
})
export class LocalAuthModule {}
