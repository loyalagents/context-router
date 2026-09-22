import { AuthService } from "./auth.service";
import {
  PreferenceStatus,
  SourceType,
} from "@infrastructure/prisma/generated-client";

describe("AuthService", () => {
  const createdUser = {
    userId: "user-1",
    email: "account@example.test",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  function createService() {
    const tx = {
      user: {
        create: jest.fn().mockResolvedValue(createdUser),
      },
      externalIdentity: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
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
    const externalIdentityService = {
      findUserIdByProviderIdentity: jest.fn().mockResolvedValue(null),
      linkIdentityToUser: jest.fn(),
    };
    const configService = {
      get: jest.fn().mockReturnValue("ON_LOGIN"),
    };
    const service = new AuthService(
      userService as any,
      auth0Service as any,
      externalIdentityService as any,
      configService as any,
      prisma as any,
    );

    return {
      service,
      tx,
      prisma,
      userService,
      auth0Service,
      externalIdentityService,
      configService,
    };
  }

  it("resolves an exact external identity before considering email", async () => {
    const {
      service,
      prisma,
      userService,
      auth0Service,
      externalIdentityService,
    } = createService();
    const existingUser = {
      ...createdUser,
      email: "existing@example.test",
    };
    externalIdentityService.findUserIdByProviderIdentity.mockResolvedValue(
      existingUser.userId,
    );
    userService.findOne.mockResolvedValue(existingUser);

    await expect(
      service.validateAndSyncUser({
        sub: "auth0|exact-identity",
        email: "recycled@example.test",
        email_verified: false,
      }),
    ).resolves.toEqual(existingUser);

    expect(
      externalIdentityService.findUserIdByProviderIdentity,
    ).toHaveBeenCalledWith("auth0", "auth0|exact-identity");
    expect(userService.findByEmail).not.toHaveBeenCalled();
    expect(externalIdentityService.linkIdentityToUser).not.toHaveBeenCalled();
    expect(auth0Service.getUserInfo).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps the hosted M2M compatibility user keyed separately by client email", async () => {
    const { service, userService, externalIdentityService } = createService();
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
    expect(
      externalIdentityService.findUserIdByProviderIdentity,
    ).not.toHaveBeenCalled();
    expect(externalIdentityService.linkIdentityToUser).not.toHaveBeenCalled();
  });

  it("seeds profile preferences for newly synced users", async () => {
    const { service, tx, prisma } = createService();

    const user = await service.validateAndSyncUser({
      sub: "auth0|profile-seed",
      email: "account@example.test",
      name: "Ada Lovelace",
      given_name: "Ada",
      family_name: "Lovelace",
    });

    expect(user).toEqual(createdUser);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: { email: "account@example.test" },
    });
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
        definitionId: "def-first-name",
        value: "Ada",
      }),
    });
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definitionId: "def-last-name",
        value: "Lovelace",
      }),
    });
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definitionId: "def-email",
        value: "account@example.test",
      }),
    });
  });

  it("does not block login when profile preference seeding fails", async () => {
    const { service, prisma } = createService();
    prisma.preferenceDefinition.findMany.mockRejectedValue(
      new Error("seed failed"),
    );

    await expect(
      service.validateAndSyncUser({
        sub: "auth0|profile-seed-failure",
        email: "account@example.test",
        name: "Ada Lovelace",
      }),
    ).resolves.toEqual(createdUser);
  });
});
