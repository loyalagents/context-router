import { Logger } from "@nestjs/common";
import {
  PreferenceStatus,
  SourceType,
} from "@infrastructure/prisma/generated-client";
import { parseIdentityLinkClaims } from "./hosted-identity-policy";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const createdUser = {
    userId: "user-1",
    email: "account@example.test",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const claims = parseIdentityLinkClaims(
    '{"version":1,"dispositions":[]}',
  );

  function createService() {
    const prisma = {
      preferenceDefinition: {
        findMany: jest.fn().mockResolvedValue([
          { id: "def-full-name", slug: "profile.full_name" },
          { id: "def-first-name", slug: "profile.first_name" },
          { id: "def-last-name", slug: "profile.last_name" },
          { id: "def-email", slug: "profile.email" },
        ]),
      },
      preference: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const userService = {
      findOne: jest.fn(),
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    const auth0Service = {
      getUserInfo: jest.fn().mockResolvedValue({ data: {} }),
    };
    const hostedIdentityRepository = {
      resolveExactOrLegacy: jest.fn().mockResolvedValue(null),
      linkOrCreate: jest.fn().mockResolvedValue({
        outcome: "created",
        user: createdUser,
      }),
    };
    const values: Record<string, unknown> = {
      "auth.auth0.issuer": "https://tenant.auth0.com/",
      "auth.auth0.legacyIssuer": "https://tenant.auth0.com/",
      "auth.auth0.identityLinkClaims": claims,
      "auth.syncStrategy": "ON_LOGIN",
    };
    const configService = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (value === undefined) throw new Error("missing test configuration");
        return value;
      }),
    };
    const service = new AuthService(
      userService as never,
      auth0Service as never,
      hostedIdentityRepository as never,
      configService as never,
      prisma as never,
    );

    return {
      service,
      prisma,
      userService,
      auth0Service,
      hostedIdentityRepository,
      configService,
      values,
    };
  }

  it.each(["exact", "legacy"] as const)(
    "resolves an %s identity before Management API or email evidence",
    async (outcome) => {
      const {
        service,
        prisma,
        auth0Service,
        hostedIdentityRepository,
      } = createService();
      const existingUser = {
        ...createdUser,
        email: "existing@example.test",
      };
      hostedIdentityRepository.resolveExactOrLegacy.mockResolvedValue({
        outcome,
        user: existingUser,
      });

      await expect(
        service.validateAndSyncUser({
          sub: "auth0|exact-identity",
          email: "recycled@example.test",
          email_verified: false,
        }),
      ).resolves.toEqual(existingUser);

      expect(
        hostedIdentityRepository.resolveExactOrLegacy,
      ).toHaveBeenCalledWith({
        issuer: "https://tenant.auth0.com/",
        legacyIssuer: "https://tenant.auth0.com/",
        subject: "auth0|exact-identity",
      });
      expect(auth0Service.getUserInfo).not.toHaveBeenCalled();
      expect(hostedIdentityRepository.linkOrCreate).not.toHaveBeenCalled();
      expect(prisma.preference.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { email: "Alice@EXAMPLE.COM", email_verified: true },
      {},
      "Alice@example.com",
    ],
    [
      {},
      { email: "Alice@EXAMPLE.COM", email_verified: true },
      "Alice@example.com",
    ],
    [
      { email: "Alice@EXAMPLE.COM", email_verified: true },
      { email: "Alice@example.com", email_verified: true },
      "Alice@example.com",
    ],
    [
      { email: "alice@example.com", email_verified: false },
      {},
      null,
    ],
    [{ email: "alice@example.com" }, {}, null],
  ])(
    "passes independently reconciled JWT and Management email evidence %#",
    async (jwt, management, verifiedEmail) => {
      const { service, auth0Service, hostedIdentityRepository } =
        createService();
      auth0Service.getUserInfo.mockResolvedValue({ data: management });

      await service.validateAndSyncUser({
        sub: "auth0|email-evidence",
        ...jwt,
      });

      expect(hostedIdentityRepository.linkOrCreate).toHaveBeenCalledWith({
        issuer: "https://tenant.auth0.com/",
        subject: "auth0|email-evidence",
        verifiedEmail,
        claims,
      });
    },
  );

  it.each([
    [
      { email: "Alice@example.com", email_verified: true },
      { email: "alice@example.com", email_verified: true },
    ],
    [
      { email: "alice@example.com", email_verified: true },
      { email: "other@example.com", email_verified: true },
    ],
    [
      { email: "alice@example.com", email_verified: true },
      { email: "alice@example.com", email_verified: false },
    ],
  ])("fails closed on conflicting email evidence %#", async (jwt, management) => {
    const { service, auth0Service, hostedIdentityRepository } = createService();
    auth0Service.getUserInfo.mockResolvedValue({ data: management });

    await expect(
      service.validateAndSyncUser({ sub: "auth0|conflict", ...jwt }),
    ).rejects.toThrow("Conflicting identity email assertions");
    expect(hostedIdentityRepository.linkOrCreate).not.toHaveBeenCalled();
  });

  it("seeds profile preferences only for a newly created principal", async () => {
    const { service, prisma, hostedIdentityRepository } = createService();

    await expect(
      service.validateAndSyncUser({
        sub: "auth0|profile-seed",
        email: "account@example.test",
        email_verified: true,
        name: "Ada Lovelace",
        given_name: "Ada",
        family_name: "Lovelace",
      }),
    ).resolves.toEqual(createdUser);

    expect(prisma.preference.create).toHaveBeenCalledTimes(4);
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        contextKey: "GLOBAL",
        definitionId: "def-full-name",
        value: "Ada Lovelace",
        status: PreferenceStatus.ACTIVE,
        sourceType: SourceType.IMPORTED,
        confidence: null,
        evidence: { source: "auth_sync" },
      }),
    });
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definitionId: "def-email",
        value: "account@example.test",
      }),
    });

    prisma.preference.create.mockClear();
    hostedIdentityRepository.linkOrCreate.mockResolvedValue({
      outcome: "linked",
      user: createdUser,
    });
    await service.validateAndSyncUser({
      sub: "auth0|approved-link",
      email: "account@example.test",
      email_verified: true,
      name: "Should Not Seed",
    });
    expect(prisma.preference.create).not.toHaveBeenCalled();
  });

  it("never seeds a synthetic fallback email into profile memory", async () => {
    const { service, prisma, hostedIdentityRepository } = createService();
    hostedIdentityRepository.linkOrCreate.mockResolvedValue({
      outcome: "created",
      user: {
        ...createdUser,
        email:
          "88038462db8b272bf1af383d1a7b3c68b693d7ea455940d7d98c84c9c1f9eb94@principal.invalid",
      },
    });

    await service.validateAndSyncUser({
      sub: "auth0|profile-without-contact",
      name: "Ada Lovelace",
    });

    expect(prisma.preference.create).toHaveBeenCalledTimes(1);
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definitionId: "def-full-name",
        value: "Ada Lovelace",
      }),
    });
    expect(prisma.preference.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ definitionId: "def-email" }),
    });
  });

  it("continues from verified JWT evidence when Management lookup fails without logging the cause", async () => {
    const { service, auth0Service, hostedIdentityRepository } = createService();
    const errorSpy = jest.spyOn(Logger.prototype, "warn");
    auth0Service.getUserInfo.mockRejectedValue(
      new Error("canary-management-secret"),
    );

    await service.validateAndSyncUser({
      sub: "auth0|management-failure-canary",
      email: "verified@example.com",
      email_verified: true,
    });

    expect(hostedIdentityRepository.linkOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ verifiedEmail: "verified@example.com" }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Auth0 profile lookup unavailable; continuing with token evidence",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "canary-management-secret",
    );
    errorSpy.mockRestore();
  });

  it("does not block login when profile preference seeding fails", async () => {
    const { service, prisma } = createService();
    prisma.preferenceDefinition.findMany.mockRejectedValue(
      new Error("seed failure canary"),
    );

    await expect(
      service.validateAndSyncUser({
        sub: "auth0|profile-seed-failure",
        email: "account@example.test",
        email_verified: true,
        name: "Ada Lovelace",
      }),
    ).resolves.toEqual(createdUser);
  });

  it("keeps the hosted M2M compatibility user keyed separately by client email", async () => {
    const { service, userService, hostedIdentityRepository } = createService();
    userService.create.mockResolvedValue(createdUser);

    await expect(
      service.findOrCreateM2MUser("client-123@clients"),
    ).resolves.toEqual(createdUser);

    expect(userService.findByEmail).toHaveBeenCalledWith(
      "client-123@clients@m2m.local",
    );
    expect(userService.create).toHaveBeenCalledWith({
      email: "client-123@clients@m2m.local",
    });
    expect(hostedIdentityRepository.resolveExactOrLegacy).not.toHaveBeenCalled();
    expect(hostedIdentityRepository.linkOrCreate).not.toHaveBeenCalled();
  });
});
