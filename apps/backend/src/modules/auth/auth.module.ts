import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { UserModule } from '@modules/user/user.module';
import { ExternalIdentityModule } from '@modules/external-identity/external-identity.module';
import { HUMAN_AUTH_STRATEGY } from '../../domains/shared/ports/human-auth.constants';
import { VerifiedHumanIdentityResolver } from './verified-human-identity.resolver';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: HUMAN_AUTH_STRATEGY }),
    UserModule,
    ExternalIdentityModule,
  ],
  providers: [
    JwtStrategy,
    VerifiedHumanIdentityResolver,
    AuthService,
    AuthResolver,
  ],
  exports: [AuthService, VerifiedHumanIdentityResolver],
})
export class AuthModule {}
