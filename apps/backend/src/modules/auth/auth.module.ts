import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { UserModule } from '@modules/user/user.module';
import { ExternalIdentityModule } from '@modules/external-identity/external-identity.module';
import { HUMAN_AUTH_STRATEGY } from '../../domains/shared/ports/human-auth.constants';
import { HostedIdentityRepository } from './hosted-identity.repository';
import { HostedIdentityAdmissionService } from './hosted-identity-admission.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: HUMAN_AUTH_STRATEGY }),
    UserModule,
    ExternalIdentityModule,
  ],
  providers: [
    JwtStrategy,
    HostedIdentityRepository,
    HostedIdentityAdmissionService,
    AuthService,
    AuthResolver,
  ],
  exports: [AuthService],
})
export class AuthModule {}
