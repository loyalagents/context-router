import { HostedIdentityRepository } from "../../src/modules/auth/hosted-identity.repository";
import {
  IDENTITY_LINK_CLAIM_METADATA_KEY,
  LEGACY_IDENTITY_ISSUER,
  computeIdentityLinkIdentityDigest,
  computeIdentityLinkRowDigest,
  createSyntheticPrincipalEmail,
  parseIdentityLinkClaims,
} from "../../src/modules/auth/hosted-identity-policy";
import { getPrismaClient } from "../setup/test-db";

const ISSUER = "https://tenant.auth0.com/";

function claimsFor(
  userId: string,
  email: string,
  subject: string,
  decision: "link" | "deny" = "link",
) {
  const rowDigest = computeIdentityLinkRowDigest(userId, email);
  const identityDigest = computeIdentityLinkIdentityDigest(ISSUER, subject);
  const disposition =
    decision === "link"
      ? [rowDigest, "link", identityDigest]
      : [rowDigest, "deny"];
  return parseIdentityLinkClaims(
    JSON.stringify({ version: 1, dispositions: [disposition] }),
  );
}

describe("HostedIdentityRepository", () => {
  const prisma = getPrismaClient();
  const repository = new HostedIdentityRepository(prisma as never);

  it("resolves only the exact issuer and subject tuple", async () => {
    const first = await prisma.user.create({
      data: { userId: "exact-first", email: "first@example.test" },
    });
    const second = await prisma.user.create({
      data: { userId: "exact-second", email: "second@example.test" },
    });
    await prisma.externalIdentity.createMany({
      data: [
        {
          userId: first.userId,
          provider: "auth0",
          issuer: ISSUER,
          providerUserId: "auth0|same-subject",
        },
        {
          userId: second.userId,
          provider: "auth0",
          issuer: "https://other.auth0.com/",
          providerUserId: "auth0|same-subject",
        },
      ],
    });

    await expect(
      repository.resolveExactOrLegacy({
        issuer: ISSUER,
        legacyIssuer: ISSUER,
        subject: "auth0|same-subject",
      }),
    ).resolves.toMatchObject({ outcome: "exact", user: first });
  });

  it("claims one sentinel identity only with the exact configured legacy issuer", async () => {
    const user = await prisma.user.create({
      data: { userId: "legacy-user", email: "legacy@example.test" },
    });
    const legacy = await prisma.externalIdentity.create({
      data: {
        id: "legacy-identity",
        userId: user.userId,
        provider: "auth0",
        issuer: LEGACY_IDENTITY_ISSUER,
        providerUserId: "auth0|legacy",
        metadata: { preserved: true },
      },
    });

    await expect(
      repository.resolveExactOrLegacy({
        issuer: ISSUER,
        legacyIssuer: ISSUER,
        subject: "auth0|legacy",
      }),
    ).resolves.toMatchObject({ outcome: "legacy", user });

    const claimed = await prisma.externalIdentity.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    expect(claimed).toMatchObject({
      id: legacy.id,
      userId: user.userId,
      issuer: ISSUER,
      metadata: { preserved: true },
    });
  });

  it("fails closed when a sentinel cannot be claimed or conflicts with an exact row", async () => {
    const first = await prisma.user.create({
      data: { userId: "conflict-first", email: "conflict-first@example.test" },
    });
    await prisma.externalIdentity.create({
      data: {
        userId: first.userId,
        provider: "auth0",
        issuer: LEGACY_IDENTITY_ISSUER,
        providerUserId: "auth0|conflict",
      },
    });

    await expect(
      repository.resolveExactOrLegacy({
        issuer: ISSUER,
        subject: "auth0|conflict",
      }),
    ).rejects.toThrow("Hosted legacy issuer configuration is required");

    const second = await prisma.user.create({
      data: {
        userId: "conflict-second",
        email: "conflict-second@example.test",
      },
    });
    await prisma.externalIdentity.create({
      data: {
        userId: second.userId,
        provider: "auth0",
        issuer: ISSUER,
        providerUserId: "auth0|conflict",
      },
    });

    await expect(
      repository.resolveExactOrLegacy({
        issuer: ISSUER,
        legacyIssuer: ISSUER,
        subject: "auth0|conflict",
      }),
    ).rejects.toThrow("Hosted identity state conflict");
  });

  it("links an exact approved tuple and writes the protected semantic marker", async () => {
    const user = await prisma.user.create({
      data: { userId: "approved-user", email: "Alice@EXAMPLE.COM" },
    });
    const subject = "auth0|approved";
    const rowDigest = computeIdentityLinkRowDigest(
      user.userId,
      "Alice@example.com",
    );
    const identityDigest = computeIdentityLinkIdentityDigest(ISSUER, subject);

    await expect(
      repository.linkOrCreate({
        issuer: ISSUER,
        subject,
        verifiedEmail: "Alice@example.com",
        claims: claimsFor(user.userId, "Alice@example.com", subject),
      }),
    ).resolves.toMatchObject({ outcome: "linked", user });

    await expect(
      prisma.externalIdentity.findFirstOrThrow(),
    ).resolves.toMatchObject({
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
    });
  });

  it("links a legacy email with allowed edge whitespace using the audited canonical key", async () => {
    const user = await prisma.user.create({
      data: { userId: "trimmed-user", email: "\tAlice@EXAMPLE.COM\r" },
    });
    const subject = "auth0|trimmed";

    await expect(
      repository.linkOrCreate({
        issuer: ISSUER,
        subject,
        verifiedEmail: "Alice@example.com",
        claims: claimsFor(user.userId, "Alice@example.com", subject),
      }),
    ).resolves.toMatchObject({ outcome: "linked", user });
    expect(await prisma.user.count()).toBe(1);
  });

  it("never falls through to creation for a denied, undispositioned, or occupied candidate", async () => {
    const user = await prisma.user.create({
      data: { userId: "blocked-user", email: "blocked@EXAMPLE.COM" },
    });
    const subject = "auth0|blocked";

    await expect(
      repository.linkOrCreate({
        issuer: ISSUER,
        subject,
        verifiedEmail: "blocked@example.com",
        claims: claimsFor(user.userId, "blocked@example.com", subject, "deny"),
      }),
    ).rejects.toThrow("Hosted identity link not approved");

    await prisma.externalIdentity.create({
      data: {
        userId: user.userId,
        provider: "auth0",
        issuer: "https://existing.example/",
        providerUserId: "existing|identity",
      },
    });
    await expect(
      repository.linkOrCreate({
        issuer: ISSUER,
        subject,
        verifiedEmail: "blocked@example.com",
        claims: claimsFor(user.userId, "blocked@example.com", subject),
      }),
    ).rejects.toThrow("Hosted identity candidate conflict");

    expect(await prisma.user.count()).toBe(1);
    expect(
      await prisma.externalIdentity.count({
        where: { issuer: ISSUER, providerUserId: subject },
      }),
    ).toBe(0);
  });

  it("fails closed for ambiguous canonical email candidates", async () => {
    await prisma.user.createMany({
      data: [
        { userId: "ambiguous-one", email: "\tAlice@EXAMPLE.COM\r" },
        { userId: "ambiguous-two", email: "Alice@example.com" },
      ],
    });

    await expect(
      repository.linkOrCreate({
        issuer: ISSUER,
        subject: "auth0|ambiguous",
        verifiedEmail: "Alice@example.com",
        claims: parseIdentityLinkClaims('{"version":1,"dispositions":[]}'),
      }),
    ).rejects.toThrow("Hosted identity email is ambiguous");
    expect(await prisma.externalIdentity.count()).toBe(0);
  });

  it("never creates a fresh principal for a subject reserved by an approved tuple", async () => {
    const user = await prisma.user.create({
      data: { userId: "reserved-subject-user", email: "reserved@example.com" },
    });
    const subject = "auth0|reserved-subject";
    const claims = claimsFor(user.userId, user.email, subject);

    await expect(
      repository.linkOrCreate({
        issuer: ISSUER,
        subject,
        verifiedEmail: null,
        claims,
      }),
    ).rejects.toThrow("Hosted identity approved link candidate required");
    await expect(
      repository.linkOrCreate({
        issuer: ISSUER,
        subject,
        verifiedEmail: "wrong@example.com",
        claims,
      }),
    ).rejects.toThrow("Hosted identity approved link candidate required");

    expect(await prisma.user.findMany()).toEqual([user]);
    expect(await prisma.externalIdentity.count()).toBe(0);
  });

  it("creates a new exact identity and uses a non-routable fallback without verified contact", async () => {
    const result = await repository.linkOrCreate({
      issuer: ISSUER,
      subject: "auth0|new-no-contact",
      verifiedEmail: null,
      claims: parseIdentityLinkClaims('{"version":1,"dispositions":[]}'),
    });

    expect(result.outcome).toBe("created");
    expect(result.user.email).toBe(
      createSyntheticPrincipalEmail(result.user.userId),
    );
    await expect(
      prisma.externalIdentity.findFirstOrThrow({
        where: { userId: result.user.userId },
      }),
    ).resolves.toMatchObject({
      provider: "auth0",
      issuer: ISSUER,
      providerUserId: "auth0|new-no-contact",
      metadata: null,
    });
  });

  it("converges same-subject races and rejects one of two distinct subjects racing for one row", async () => {
    const emptyClaims = parseIdentityLinkClaims(
      '{"version":1,"dispositions":[]}',
    );
    const sameSubject = await Promise.all([
      repository.linkOrCreate({
        issuer: ISSUER,
        subject: "auth0|same-race",
        verifiedEmail: null,
        claims: emptyClaims,
      }),
      repository.linkOrCreate({
        issuer: ISSUER,
        subject: "auth0|same-race",
        verifiedEmail: null,
        claims: emptyClaims,
      }),
    ]);
    expect(new Set(sameSubject.map((result) => result.user.userId)).size).toBe(
      1,
    );

    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
    const candidate = await prisma.user.create({
      data: { userId: "race-candidate", email: "race@example.com" },
    });
    const firstSubject = "auth0|race-first";
    const secondSubject = "auth0|race-second";
    const distinctSubject = await Promise.allSettled([
      repository.linkOrCreate({
        issuer: ISSUER,
        subject: firstSubject,
        verifiedEmail: candidate.email,
        claims: claimsFor(candidate.userId, candidate.email, firstSubject),
      }),
      repository.linkOrCreate({
        issuer: ISSUER,
        subject: secondSubject,
        verifiedEmail: candidate.email,
        claims: claimsFor(candidate.userId, candidate.email, secondSubject),
      }),
    ]);

    expect(
      distinctSubject.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      distinctSubject.filter(({ status }) => status === "rejected"),
    ).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.externalIdentity.count()).toBe(1);
  });
});
