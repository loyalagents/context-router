import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { UserModule } from '@modules/user/user.module';
import { ExternalIdentityModule } from '@modules/external-identity/external-identity.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    UserModule,
    ExternalIdentityModule,
  ],
  providers: [JwtStrategy, AuthService, AuthResolver],
  exports: [AuthService],
})
export class AuthModule {}
