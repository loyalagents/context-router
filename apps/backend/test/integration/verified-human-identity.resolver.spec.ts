import type { PrismaClient } from '@infrastructure/prisma/generated-client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { AuthService } from '@modules/auth/auth.service';
import {
  createM2MCompatibilityEmail,
  createM2MCompatibilityPrincipalId,
  type M2MCompatibilityIdentityKey,
} from '@modules/auth/principal-identity';
import { VerifiedHumanIdentityResolver } from '@modules/auth/verified-human-identity.resolver';
import type { UserService } from '@modules/user/user.service';
import { getPrismaClient } from '../setup/test-db';

describe('provider-neutral identity persistence (integration)', () => {
  let prisma: PrismaClient;
  let prismaService: PrismaService;
  let resolver: VerifiedHumanIdentityResolver;
  let authService: AuthService;

  beforeAll(() => {
    prisma = getPrismaClient();
    prismaService = prisma as unknown as PrismaService;
    resolver = new VerifiedHumanIdentityResolver(prismaService);
    authService = new AuthService({} as UserService, prismaService);
  });

  describe('verified human identities', () => {
    it('converges concurrent resolution of one exact tuple', async () => {
      const assertion = {
        key: {
          provider: 'example-idp',
          issuer: 'https://issuer.example.test/',
          subject: 'shared-subject',
        },
      } as const;

      const results = await Promise.all(
        Array.from({ length: 12 }, () => resolver.resolve(assertion)),
      );

      expect(new Set(results.map(({ userId }) => userId)).size).toBe(1);
      await expect(prisma.user.count()).resolves.toBe(1);
      await expect(prisma.externalIdentity.count()).resolves.toBe(1);
    });

    it('keeps distinct tuples separate even when verified email matches', async () => {
      const profileHints = { verifiedEmail: 'shared@example.test' } as const;
      const first = await resolver.resolve({
        key: {
          provider: 'example-idp',
          issuer: 'https://issuer-one.example.test/',
          subject: 'subject',
        },
        profileHints,
      });
      const second = await resolver.resolve({
        key: {
          provider: 'second-idp',
          issuer: 'https://issuer-two.example.test/',
          subject: 'subject',
        },
        profileHints,
      });

      expect(first.userId).not.toBe(second.userId);
      expect(first.email).toBe(profileHints.verifiedEmail);
      expect(second.email).toBe(profileHints.verifiedEmail);
      await expect(prisma.user.count()).resolves.toBe(2);
      await expect(prisma.externalIdentity.count()).resolves.toBe(2);
    });

    it('rolls back the user when the identity insert fails', async () => {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION fail_step03_identity_insert() RETURNS trigger AS $$
        BEGIN
          IF NEW.provider_user_id = 'forced-insert-failure' THEN
            RAISE EXCEPTION 'forced identity insert failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER fail_step03_identity_insert
        BEFORE INSERT ON "external_identities"
        FOR EACH ROW EXECUTE FUNCTION fail_step03_identity_insert()
      `);

      try {
        await expect(
          resolver.resolve({
            key: {
              provider: 'example-idp',
              issuer: 'https://issuer.example.test/',
              subject: 'forced-insert-failure',
            },
          }),
        ).rejects.toThrow('Human identity resolution failed');
        await expect(prisma.user.count()).resolves.toBe(0);
        await expect(prisma.externalIdentity.count()).resolves.toBe(0);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS fail_step03_identity_insert ON "external_identities"',
        );
        await prisma.$executeRawUnsafe(
          'DROP FUNCTION IF EXISTS fail_step03_identity_insert()',
        );
      }
    });
  });

  describe('hosted M2M compatibility', () => {
    const identity: M2MCompatibilityIdentityKey = {
      provider: 'auth0',
      issuer: 'https://tenant.example.test/',
      subject: 'automation@clients',
    };

    it('converges parallel upserts without creating an external identity', async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          authService.findOrCreateM2MUser(identity),
        ),
      );

      expect(new Set(results.map(({ userId }) => userId))).toEqual(
        new Set([createM2MCompatibilityPrincipalId(identity)]),
      );
      await expect(prisma.user.count()).resolves.toBe(1);
      await expect(prisma.externalIdentity.count()).resolves.toBe(0);
    });

    it('scopes the same subject to its issuer', async () => {
      const otherAuthority = {
        ...identity,
        issuer: 'https://other-tenant.example.test/',
      };

      const first = await authService.findOrCreateM2MUser(identity);
      const second = await authService.findOrCreateM2MUser(otherAuthority);

      expect(first.userId).toBe(createM2MCompatibilityPrincipalId(identity));
      expect(second.userId).toBe(
        createM2MCompatibilityPrincipalId(otherAuthority),
      );
      expect(first.userId).not.toBe(second.userId);
      await expect(prisma.externalIdentity.count()).resolves.toBe(0);
    });

    it('fails closed when the deterministic principal row conflicts', async () => {
      await prisma.user.create({
        data: {
          userId: createM2MCompatibilityPrincipalId(identity),
          email: 'conflict@principal.invalid',
        },
      });

      await expect(authService.findOrCreateM2MUser(identity)).rejects.toThrow(
        'Hosted M2M compatibility principal conflict',
      );
      expect(createM2MCompatibilityEmail(identity)).not.toBe(
        'conflict@principal.invalid',
      );
      await expect(prisma.externalIdentity.count()).resolves.toBe(0);
    });
  });
});
