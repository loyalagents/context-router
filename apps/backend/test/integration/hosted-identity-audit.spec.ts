import { randomBytes } from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../../src/infrastructure/prisma/generated-client";
import { HostedIdentityAdmissionService } from "../../src/modules/auth/hosted-identity-admission.service";
import { HostedIdentityAuditService } from "../../src/modules/auth/hosted-identity-audit";
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

describe("HostedIdentityAuditService", () => {
  const prisma = getPrismaClient();
  const repository = new HostedIdentityRepository(prisma as never);
  const audit = new HostedIdentityAuditService(repository);

  it("binds the complete live cohort and retains consumed markers for admission", async () => {
    const pendingLink = await prisma.user.create({
      data: { userId: "audit-link", email: "Link@EXAMPLE.COM" },
    });
    const pendingDenyOne = await prisma.user.create({
      data: { userId: "audit-deny-one", email: "Duplicate@EXAMPLE.COM" },
    });
    const pendingDenyTwo = await prisma.user.create({
      data: { userId: "audit-deny-two", email: "Duplicate@example.com" },
    });
    const consumed = await prisma.user.create({
      data: { userId: "audit-consumed", email: "consumed@example.com" },
    });
    const consumedSubject = "auth0|audit-consumed";
    const consumedRowDigest = computeIdentityLinkRowDigest(
      consumed.userId,
      consumed.email,
    );
    const consumedIdentityDigest = computeIdentityLinkIdentityDigest(
      ISSUER,
      consumedSubject,
    );
    await prisma.externalIdentity.create({
      data: {
        id: "audit-consumed-identity",
        userId: consumed.userId,
        provider: "auth0",
        issuer: ISSUER,
        providerUserId: consumedSubject,
        metadata: {
          [IDENTITY_LINK_CLAIM_METADATA_KEY]: {
            version: 1,
            rowDigest: consumedRowDigest,
            identityDigest: consumedIdentityDigest,
          },
        },
      },
    });
    const linkSubject = "auth0|audit-link";
    const intent = [
      {
        userId: pendingLink.userId,
        email: pendingLink.email,
        decision: "link" as const,
        issuer: ISSUER,
        subject: linkSubject,
      },
      {
        userId: pendingDenyOne.userId,
        email: pendingDenyOne.email,
        decision: "deny" as const,
      },
      {
        userId: pendingDenyTwo.userId,
        email: pendingDenyTwo.email,
        decision: "deny" as const,
      },
    ].sort((left, right) =>
      Buffer.compare(Buffer.from(left.userId), Buffer.from(right.userId)),
    );

    const output = await audit.audit(intent, {
      issuer: ISSUER,
      legacyIssuer: ISSUER,
    });

    expect(output.counts).toEqual({
      pending: 3,
      consumed: 1,
      link: 2,
      deny: 2,
      total: 4,
    });
    const claims = parseIdentityLinkClaims(output.identityLinkClaims);
    expect(claims.digest).toBe(output.digest);
    const serialized = JSON.stringify(output);
    for (const canary of [
      pendingLink.userId,
      pendingLink.email,
      linkSubject,
      consumedSubject,
    ]) {
      expect(serialized).not.toContain(canary);
    }

    const values: Record<string, unknown> = {
      "auth.auth0.issuer": ISSUER,
      "auth.auth0.legacyIssuer": ISSUER,
      "auth.auth0.identityLinkClaims": claims,
    };
    const configuration = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (value === undefined) throw new Error("missing test configuration");
        return value;
      }),
    };
    await expect(
      new HostedIdentityAdmissionService(
        repository,
        configuration as never,
      ).verify(),
    ).resolves.toBeUndefined();
  });

  it("rejects proposed subjects occupied by exact or sentinel identities", async () => {
    const pending = await prisma.user.create({
      data: { userId: "audit-pending", email: "pending@example.com" },
    });
    const exact = await prisma.user.create({
      data: { userId: "audit-exact", email: "exact@example.com" },
    });
    const sentinel = await prisma.user.create({
      data: { userId: "audit-sentinel", email: "sentinel@example.com" },
    });
    const subject = "auth0|audit-conflict";
    await prisma.externalIdentity.createMany({
      data: [
        {
          userId: exact.userId,
          provider: "auth0",
          issuer: ISSUER,
          providerUserId: subject,
        },
        {
          userId: sentinel.userId,
          provider: "auth0",
          issuer: LEGACY_IDENTITY_ISSUER,
          providerUserId: subject,
        },
      ],
    });

    await expect(
      audit.audit(
        [
          {
            userId: pending.userId,
            email: pending.email,
            decision: "link",
            issuer: ISSUER,
            subject,
          },
        ],
        { issuer: ISSUER, legacyIssuer: ISSUER },
      ),
    ).rejects.toThrow("Hosted identity audit subject conflict");
  });

  it("rejects an exact and sentinel duplicate without a pending cohort", async () => {
    const users = await Promise.all([
      prisma.user.create({
        data: { userId: "audit-duplicate-exact", email: "exact@example.com" },
      }),
      prisma.user.create({
        data: {
          userId: "audit-duplicate-sentinel",
          email: "sentinel@example.com",
        },
      }),
    ]);
    const subject = "auth0|audit-global-conflict";
    await prisma.externalIdentity.createMany({
      data: [
        {
          userId: users[0].userId,
          provider: "auth0",
          issuer: ISSUER,
          providerUserId: subject,
        },
        {
          userId: users[1].userId,
          provider: "auth0",
          issuer: LEGACY_IDENTITY_ISSUER,
          providerUserId: subject,
        },
      ],
    });

    await expect(
      audit.audit([], { issuer: ISSUER, legacyIssuer: ISSUER }),
    ).rejects.toThrow("Hosted identity audit subject conflict");
  });

  it("detects the issuer column on the relation resolved later in the search path", async () => {
    const leadingSchema = `step03_empty_${randomBytes(8).toString("hex")}`;
    const user = await prisma.user.create({
      data: { userId: "resolved-relation-user", email: "exact@example.test" },
    });
    await prisma.externalIdentity.create({
      data: {
        userId: user.userId,
        provider: "auth0",
        issuer: ISSUER,
        providerUserId: "auth0|resolved-relation",
      },
    });
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${leadingSchema}"`);

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${leadingSchema},public`,
    });
    const scopedPrisma = new PrismaClient({
      adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    });
    try {
      await expect(
        new HostedIdentityAuditService(
          new HostedIdentityRepository(scopedPrisma as never),
        ).audit([], { issuer: ISSUER }),
      ).resolves.toMatchObject({
        counts: { pending: 0, consumed: 0, link: 0, deny: 0, total: 0 },
      });
    } finally {
      await scopedPrisma.$disconnect();
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${leadingSchema}" CASCADE`);
    }
  });
});
