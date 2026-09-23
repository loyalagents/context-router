import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AuthGuard } from '@nestjs/passport';
import { GqlAuthGuard } from '../../src/common/guards/gql-auth.guard';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { OptionalGqlAuthGuard } from '../../src/common/guards/optional-gql-auth.guard';
import { HUMAN_AUTH_STRATEGY } from '../../src/domains/shared/ports/human-auth.constants';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import passport from 'passport';

const backendRoot = join(__dirname, '..', '..');
const sourceRoot = join(backendRoot, 'src');
const strategyTokenPath = join(
  sourceRoot,
  'domains/shared/ports/human-auth.constants.ts',
);

function readSource(relativePath: string): string {
  return readFileSync(join(sourceRoot, relativePath), 'utf8');
}

describe('human authentication composition contract', () => {
  it('binds common human guards and the hosted adapter to one stable strategy name', () => {
    expect(existsSync(strategyTokenPath)).toBe(true);

    const strategyTokens = require(strategyTokenPath) as Record<string, string>;
    expect(strategyTokens.HUMAN_AUTH_STRATEGY).toBe('human');

    for (const guardPath of [
      'common/guards/gql-auth.guard.ts',
      'common/guards/optional-gql-auth.guard.ts',
      'common/guards/jwt-auth.guard.ts',
    ]) {
      const source = readSource(guardPath);
      expect(source).toContain('HUMAN_AUTH_STRATEGY');
      expect(source).toMatch(/AuthGuard\(HUMAN_AUTH_STRATEGY\)/);
      expect(source).not.toMatch(/AuthGuard\(["']jwt["']\)/);
    }

    const authModule = readSource('modules/auth/auth.module.ts');
    expect(authModule).toContain('HUMAN_AUTH_STRATEGY');
    expect(authModule).toMatch(
      /PassportModule\.register\(\{\s*defaultStrategy:\s*HUMAN_AUTH_STRATEGY\s*\}\)/,
    );
    expect(authModule).toContain('VerifiedHumanIdentityResolver');

    const appModule = readSource('app.module.ts');
    expect(appModule).not.toContain('Auth0Module');

    const hostedStrategy = readSource(
      'modules/auth/strategies/jwt.strategy.ts',
    );
    expect(hostedStrategy).toContain('HUMAN_AUTH_STRATEGY');
    expect(hostedStrategy).toMatch(
      /PassportStrategy\(Strategy,\s*HUMAN_AUTH_STRATEGY\)/,
    );
    expect(hostedStrategy).toContain('findOrCreateM2MUser');

    const humanGuard = AuthGuard(HUMAN_AUTH_STRATEGY);
    for (const guard of [GqlAuthGuard, JwtAuthGuard, OptionalGqlAuthGuard]) {
      expect(guard.prototype).toBeInstanceOf(humanGuard);
    }

    const strategy = new JwtStrategy(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            'auth.auth0.audience': 'https://context-router.test',
            'auth.auth0.issuer': 'https://tenant.auth0.test/',
            'auth.auth0.jwksUri':
              'https://tenant.auth0.test/.well-known/jwks.json',
          };
          return values[key];
        }),
      } as never,
      { findOrCreateM2MUser: jest.fn() } as never,
      { resolve: jest.fn() } as never,
    );
    expect(passport._strategy(HUMAN_AUTH_STRATEGY)).toBe(strategy);
    passport.unuse(HUMAN_AUTH_STRATEGY);
  });

  it('binds local human authentication without importing hosted identity providers', () => {
    const localStrategy = readSource(
      'modules/auth/strategies/local-identity.strategy.ts',
    );
    const localAuthModule = readSource('modules/auth/local-auth.module.ts');

    expect(localStrategy).toContain('HUMAN_AUTH_STRATEGY');
    expect(localStrategy).toMatch(
      /PassportStrategy\([\s\S]*HUMAN_AUTH_STRATEGY/,
    );
    expect(localStrategy).toContain('timingSafeEqual');
    expect(localAuthModule).toMatch(
      /PassportModule\.register\(\{\s*defaultStrategy:\s*HUMAN_AUTH_STRATEGY\s*\}\)/,
    );
    expect(localAuthModule).toContain('LocalIdentityStrategy');
    expect(localAuthModule).toContain('AuthResolver');
    for (const forbidden of [
      "from './auth.module'",
      'JwtStrategy',
      'VerifiedHumanIdentityResolver',
      'ExternalIdentityModule',
      'McpModule',
    ]) {
      expect(localAuthModule).not.toContain(forbidden);
    }
  });
});
