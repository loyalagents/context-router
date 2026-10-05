import { DynamicModule, Global, Injectable, Module } from '@nestjs/common';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import passport from 'passport';
import type { Request } from 'express';
import { HUMAN_AUTH_STRATEGY } from '../domains/shared/ports/human-auth.constants';
import { AuthResolver } from '../modules/auth/auth.resolver';
import { UserModule } from '../modules/user/user.module';
import { UserService } from '../modules/user/user.service';
import { LocalUiSessions } from './local-ui-sessions';
import { readBrowserBearer } from './local-ui-request';

class BrowserPassportStrategy extends passport.Strategy {
  constructor(
    private readonly verifyRequest: (
      req: Request,
      done: (error: unknown, user?: Express.User | false) => void,
    ) => void,
  ) {
    super();
  }
  authenticate(req: Request): void {
    const strategy = this as passport.StrategyCreated<BrowserPassportStrategy>;
    this.verifyRequest(req, (error, user) => {
      if (error) strategy.error(error);
      else if (!user) strategy.fail(401);
      else strategy.success(user);
    });
  }
}
@Injectable()
class LocalUiIdentityStrategy extends PassportStrategy(
  BrowserPassportStrategy,
  HUMAN_AUTH_STRATEGY,
) {
  constructor(
    private readonly sessions: LocalUiSessions,
    private readonly users: UserService,
  ) {
    super();
  }
  async validate(req: Request) {
    const token = readBrowserBearer(req);
    const principal = this.sessions.authenticate(token);
    if (!principal) return false;
    try {
      const user = await this.users.findOne(principal);
      return user.userId === principal &&
        this.sessions.authenticate(token) === principal
        ? user
        : false;
    } catch {
      return false;
    }
  }
}
@Global()
@Module({})
export class LocalUiAuthModule {
  static register(sessions: LocalUiSessions): DynamicModule {
    return {
      module: LocalUiAuthModule,
      global: true,
      imports: [
        PassportModule.register({ defaultStrategy: HUMAN_AUTH_STRATEGY }),
        UserModule,
      ],
      providers: [
        { provide: LocalUiSessions, useValue: sessions },
        LocalUiIdentityStrategy,
        AuthResolver,
      ],
      exports: [LocalUiSessions],
    };
  }
}
