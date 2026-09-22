import { HostedIdentityAdmissionService } from "../../src/modules/auth/hosted-identity-admission.service";
import { HostedIdentityRepository } from "../../src/modules/auth/hosted-identity.repository";
import {
  IDENTITY_LINK_CLAIM_METADATA_KEY,
  LEGACY_IDENTITY_ISSUER,
  computeIdentityLinkIdentityDigest,
  computeIdentityLinkRowDigest,
  parseIdentityLinkClaims,
} from "../../src/modules/auth/hosted-identity-policy";
import { getPrismaClient } from "../setup/test-db";

const ISSUER = "https://tenant.auth0.com/";

function buildClaims(
  dispositions: Array<[string, "deny"] | [string, "link", string]>,
) {
  return parseIdentityLinkClaims(
    JSON.stringify({
      version: 1,
      dispositions: [...dispositions].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    }),
  );
}

describe("HostedIdentityAdmissionService", () => {
  const prisma = getPrismaClient();
  const repository = new HostedIdentityRepository(prisma as never);

  function createService(
    claims = buildClaims([]),
    legacyIssuer: string | null = ISSUER,
  ) {
    const values: Record<string, unknown> = {
      "auth.auth0.issuer": ISSUER,
      "auth.auth0.legacyIssuer": legacyIssuer ?? undefined,
      "auth.auth0.identityLinkClaims": claims,
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (value === undefined) throw new Error("missing test configuration");
        return value;
      }),
    };
    return new HostedIdentityAdmissionService(repository, config as never);
  }

  it("admits an empty cohort and enforces conditional legacy issuer configuration", async () => {
    await expect(
      createService(undefined, null).verify(),
    ).resolves.toBeUndefined();

    const user = await prisma.user.create({
      data: { userId: "sentinel-user", email: "sentinel@example.test" },
    });
    await prisma.externalIdentity.create({
      data: {
        userId: user.userId,
        provider: "auth0",
        issuer: LEGACY_IDENTITY_ISSUER,
        providerUserId: "auth0|sentinel",
      },
    });
    await expect(createService(undefined, null).verify()).rejects.toThrow(
      "Hosted legacy issuer configuration is required",
    );
    await expect(createService().verify()).resolves.toBeUndefined();
  });

  it("requires complete dispositions and permits only deny for ambiguous email groups", async () => {
    const users = await Promise.all([
      prisma.user.create({
        data: { userId: "pending-one", email: "Alice@EXAMPLE.COM" },
      }),
      prisma.user.create({
        data: { userId: "pending-two", email: "Alice@example.com" },
      }),
      prisma.user.create({
        data: { userId: "pending-three", email: "unique@example.com" },
      }),
    ]);
    const rowOne = computeIdentityLinkRowDigest(
      users[0].userId,
      "Alice@example.com",
    );
    const rowTwo = computeIdentityLinkRowDigest(
      users[1].userId,
      "Alice@example.com",
    );
    const rowThree = computeIdentityLinkRowDigest(
      users[2].userId,
      users[2].email,
    );
    const identityThree = computeIdentityLinkIdentityDigest(
      ISSUER,
      "auth0|pending-three",
    );

    await expect(
      createService(
        buildClaims([
          [rowOne, "deny"],
          [rowTwo, "deny"],
          [rowThree, "link", identityThree],
        ]),
      ).verify(),
    ).resolves.toBeUndefined();

    await expect(
      createService(buildClaims([[rowOne, "deny"]])).verify(),
    ).rejects.toThrow("Hosted identity admission cohort mismatch");
    await expect(
      createService(
        buildClaims([
          [
            rowOne,
            "link",
            computeIdentityLinkIdentityDigest(ISSUER, "auth0|ambiguous"),
          ],
          [rowTwo, "deny"],
          [rowThree, "link", identityThree],
        ]),
      ).verify(),
    ).rejects.toThrow("Ambiguous hosted identity email must be denied");
  });

  it("classifies an exact marked sole identity as a consumed link disposition", async () => {
    const user = await prisma.user.create({
      data: { userId: "consumed-user", email: "consumed@example.com" },
    });
    const subject = "auth0|consumed";
    const rowDigest = computeIdentityLinkRowDigest(user.userId, user.email);
    const identityDigest = computeIdentityLinkIdentityDigest(ISSUER, subject);
    await prisma.externalIdentity.create({
      data: {
        userId: user.userId,
        provider: "auth0",
        issuer: ISSUER,
        providerUserId: subject,
        metadata: {
          [IDENTITY_LINK_CLAIM_METADATA_KEY]: {
            version: 1,
            rowDigest,
            identityDigest,
          },
        },
      },
    });

    await expect(
      createService(
        buildClaims([[rowDigest, "link", identityDigest]]),
      ).verify(),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed, drifting, or multiply bound consumed markers", async () => {
    const user = await prisma.user.create({
      data: { userId: "drift-user", email: "drift@example.com" },
    });
    const subject = "auth0|drift";
    const rowDigest = computeIdentityLinkRowDigest(user.userId, user.email);
    const identityDigest = computeIdentityLinkIdentityDigest(ISSUER, subject);
    await prisma.externalIdentity.create({
      data: {
        userId: user.userId,
        provider: "auth0",
        issuer: ISSUER,
        providerUserId: subject,
        metadata: {
          [IDENTITY_LINK_CLAIM_METADATA_KEY]: {
            version: 1,
            rowDigest,
            identityDigest,
          },
          unexpected: true,
        },
      },
    });

    await expect(
      createService(
        buildClaims([[rowDigest, "link", identityDigest]]),
      ).verify(),
    ).rejects.toThrow("Hosted identity marker drift");
  });

  it("rejects extra dispositions that classify neither a pending nor consumed row", async () => {
    const extraRow = computeIdentityLinkRowDigest(
      "missing-user",
      "missing@example.com",
    );
    await expect(
      createService(buildClaims([[extraRow, "deny"]])).verify(),
    ).rejects.toThrow("Hosted identity admission cohort mismatch");
  });

  it("rejects a pending approved subject already occupied by an unmarked identity", async () => {
    const pending = await prisma.user.create({
      data: { userId: "pending-conflict", email: "pending@example.com" },
    });
    const occupied = await prisma.user.create({
      data: { userId: "occupied-conflict", email: "occupied@example.com" },
    });
    const subject = "auth0|occupied-pending-subject";
    await prisma.externalIdentity.create({
      data: {
        userId: occupied.userId,
        provider: "auth0",
        issuer: ISSUER,
        providerUserId: subject,
      },
    });

    await expect(
      createService(
        buildClaims([
          [
            computeIdentityLinkRowDigest(pending.userId, pending.email),
            "link",
            computeIdentityLinkIdentityDigest(ISSUER, subject),
          ],
        ]),
      ).verify(),
    ).rejects.toThrow("Hosted identity admission subject conflict");
  });

  it("rejects an exact and sentinel identity sharing one subject even with empty claims", async () => {
    const users = await Promise.all([
      prisma.user.create({
        data: { userId: "duplicate-exact", email: "exact@example.com" },
      }),
      prisma.user.create({
        data: { userId: "duplicate-sentinel", email: "sentinel@example.com" },
      }),
    ]);
    await prisma.externalIdentity.createMany({
      data: [
        {
          userId: users[0].userId,
          provider: "auth0",
          issuer: ISSUER,
          providerUserId: "auth0|duplicate-subject",
        },
        {
          userId: users[1].userId,
          provider: "auth0",
          issuer: LEGACY_IDENTITY_ISSUER,
          providerUserId: "auth0|duplicate-subject",
        },
      ],
    });

    await expect(createService().verify()).rejects.toThrow(
      "Hosted identity admission subject conflict",
    );
  });
});
