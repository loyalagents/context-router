import { ExternalIdentityRepository } from "./external-identity.repository";
import { IDENTITY_LINK_CLAIM_METADATA_KEY } from "../auth/hosted-identity-policy";

describe("ExternalIdentityRepository", () => {
  const identity = {
    id: "identity-1",
    userId: "user-1",
    provider: "auth0",
    issuer: "https://tenant.auth0.com/",
    providerUserId: "auth0|one",
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  function createRepository() {
    const transactionIdentity = {
      findUnique: jest.fn().mockResolvedValue(identity),
      update: jest.fn().mockResolvedValue(identity),
      delete: jest.fn().mockResolvedValue(identity),
    };
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn().mockResolvedValue(identity),
        findMany: jest.fn().mockResolvedValue([identity]),
        create: jest.fn().mockResolvedValue(identity),
      },
      $transaction: jest.fn(async (callback) =>
        callback({ externalIdentity: transactionIdentity }),
      ),
    };
    return {
      repository: new ExternalIdentityRepository(prisma as never),
      prisma,
      transactionIdentity,
    };
  }

  it("looks up the exact provider, issuer, and subject tuple", async () => {
    const { repository, prisma } = createRepository();

    await expect(
      repository.findByProviderAndUserId(
        "auth0",
        "https://tenant.auth0.com/",
        "auth0|one",
      ),
    ).resolves.toEqual(identity);

    expect(prisma.externalIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_issuer_providerUserId: {
          provider: "auth0",
          issuer: "https://tenant.auth0.com/",
          providerUserId: "auth0|one",
        },
      },
    });
  });

  it("requires issuer on every generic create", async () => {
    const { repository, prisma } = createRepository();

    await repository.create({
      userId: "user-1",
      provider: "auth0",
      issuer: "https://tenant.auth0.com/",
      providerUserId: "auth0|one",
    });

    expect(prisma.externalIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        provider: "auth0",
        issuer: "https://tenant.auth0.com/",
        providerUserId: "auth0|one",
        metadata: undefined,
      },
    });
  });

  it("rejects the reserved link marker in generic create or metadata update", async () => {
    const { repository, prisma } = createRepository();
    const protectedMetadata = {
      [IDENTITY_LINK_CLAIM_METADATA_KEY]: { version: 1 },
    };

    await expect(
      repository.create({
        userId: "user-1",
        provider: "auth0",
        issuer: "https://tenant.auth0.com/",
        providerUserId: "auth0|one",
        metadata: protectedMetadata,
      }),
    ).rejects.toThrow("Protected identity link metadata");
    await expect(
      repository.update("identity-1", { metadata: protectedMetadata }),
    ).rejects.toThrow("Protected identity link metadata");

    expect(prisma.externalIdentity.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses generic update and unlink for an identity carrying the link marker", async () => {
    const { repository, transactionIdentity } = createRepository();
    transactionIdentity.findUnique.mockResolvedValue({
      ...identity,
      metadata: {
        [IDENTITY_LINK_CLAIM_METADATA_KEY]: {
          version: 1,
          rowDigest: "row",
          identityDigest: "identity",
        },
      },
    });

    await expect(
      repository.update("identity-1", { metadata: { safe: true } }),
    ).rejects.toThrow("Protected identity link metadata");
    await expect(repository.delete("identity-1")).rejects.toThrow(
      "Protected identity link metadata",
    );

    expect(transactionIdentity.update).not.toHaveBeenCalled();
    expect(transactionIdentity.delete).not.toHaveBeenCalled();
  });
});
