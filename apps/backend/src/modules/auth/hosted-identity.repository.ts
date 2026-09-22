import { randomUUID } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@infrastructure/prisma/generated-client";
import type { User } from "@infrastructure/prisma/prisma-models";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import {
  IDENTITY_LINK_CLAIM_METADATA_KEY,
  LEGACY_IDENTITY_ISSUER,
  type IdentityLinkClaims,
  canonicalizeIdentityLinkEmail,
  computeIdentityLinkIdentityDigest,
  computeIdentityLinkRowDigest,
  createSyntheticPrincipalEmail,
  isReservedIdentityLinkEmail,
  parseIdentityLinkClaims,
} from "./hosted-identity-policy";

const AUTH0_PROVIDER = "auth0";
const ASCII_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ASCII_LOWER = "abcdefghijklmnopqrstuvwxyz";
const SERIALIZABLE_ATTEMPTS = 5;
const LINK_CLAIMS_MAX_MARKERS = 256;

type TransactionClient = Prisma.TransactionClient;

export type HostedIdentityResolutionOutcome =
  | "exact"
  | "legacy"
  | "linked"
  | "created";

export interface HostedIdentityResolution {
  outcome: HostedIdentityResolutionOutcome;
  user: User;
}

export interface ResolveExactOrLegacyInput {
  issuer: string;
  legacyIssuer?: string;
  subject: string;
}

export interface LinkOrCreateHostedIdentityInput {
  issuer: string;
  subject: string;
  verifiedEmail: string | null;
  claims: IdentityLinkClaims;
}

export interface HostedIdentityAdmissionUser {
  userId: string;
  email: string;
}

export interface HostedIdentityAdmissionMarker {
  id: string;
  userId: string;
  provider: string;
  issuer: string;
  providerUserId: string;
  metadata: unknown;
  email: string;
  identityCount: number;
}

export interface HostedIdentityAdmissionSubject {
  id: string;
  userId: string;
  issuer: string;
  providerUserId: string;
}

export interface HostedIdentityAdmissionSnapshot {
  sentinelRowCount: number;
  allUsers: HostedIdentityAdmissionUser[];
  zeroIdentityUsers: HostedIdentityAdmissionUser[];
  markedIdentities: HostedIdentityAdmissionMarker[];
  hostedIdentities: HostedIdentityAdmissionSubject[];
}

export interface HostedIdentityAuditSnapshot
  extends HostedIdentityAdmissionSnapshot {
  conflictingSubjects: string[];
}

interface EmailCandidateRow {
  userId: string;
  email: string;
  identityCount: number;
}

function asUser(user: User): User {
  return {
    userId: user.userId,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function fixedFailure(message: string): never {
  throw new Error(message);
}

@Injectable()
export class HostedIdentityRepository {
  private readonly logger = new Logger(HostedIdentityRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveExactOrLegacy(
    input: ResolveExactOrLegacyInput,
  ): Promise<HostedIdentityResolution | null> {
    return this.runSerializable(async (transaction) => {
      const [exact, legacy] = await Promise.all([
        transaction.externalIdentity.findUnique({
          where: {
            provider_issuer_providerUserId: {
              provider: AUTH0_PROVIDER,
              issuer: input.issuer,
              providerUserId: input.subject,
            },
          },
          include: { user: true },
        }),
        transaction.externalIdentity.findUnique({
          where: {
            provider_issuer_providerUserId: {
              provider: AUTH0_PROVIDER,
              issuer: LEGACY_IDENTITY_ISSUER,
              providerUserId: input.subject,
            },
          },
          include: { user: true },
        }),
      ]);

      if (exact && legacy) {
        return fixedFailure("Hosted identity state conflict");
      }
      if (exact) {
        this.logger.debug("Resolved an exact hosted identity");
        return { outcome: "exact", user: asUser(exact.user) };
      }
      if (!legacy) {
        return null;
      }
      if (input.legacyIssuer !== input.issuer) {
        return fixedFailure("Hosted legacy issuer configuration is required");
      }

      const claimed = await transaction.externalIdentity.update({
        where: { id: legacy.id },
        data: { issuer: input.issuer },
        include: { user: true },
      });
      this.logger.log("Claimed a legacy hosted identity");
      return { outcome: "legacy", user: asUser(claimed.user) };
    });
  }

  async linkOrCreate(
    input: LinkOrCreateHostedIdentityInput,
  ): Promise<HostedIdentityResolution> {
    const verifiedEmail = this.validateVerifiedEmail(input.verifiedEmail);

    return this.runSerializable(async (transaction) => {
      const claims = parseIdentityLinkClaims(input.claims.canonical);
      if (claims.digest !== input.claims.digest) {
        return fixedFailure("Invalid identity link claims");
      }

      const exact = await transaction.externalIdentity.findUnique({
        where: {
          provider_issuer_providerUserId: {
            provider: AUTH0_PROVIDER,
            issuer: input.issuer,
            providerUserId: input.subject,
          },
        },
        include: { user: true },
      });
      if (exact) {
        this.logger.debug("Resolved a concurrent exact hosted identity");
        return { outcome: "exact", user: asUser(exact.user) };
      }

      const legacy = await transaction.externalIdentity.findUnique({
        where: {
          provider_issuer_providerUserId: {
            provider: AUTH0_PROVIDER,
            issuer: LEGACY_IDENTITY_ISSUER,
            providerUserId: input.subject,
          },
        },
        select: { id: true },
      });
      if (legacy) {
        return fixedFailure("Hosted identity state conflict");
      }

      if (verifiedEmail) {
        const candidates = await this.findEmailCandidates(
          transaction,
          verifiedEmail,
        );
        if (candidates.length > 1) {
          return fixedFailure("Hosted identity email is ambiguous");
        }
        if (candidates.length === 1) {
          return this.linkCandidate(transaction, input, claims, candidates[0]);
        }
      }

      const identityDigest = computeIdentityLinkIdentityDigest(
        input.issuer,
        input.subject,
      );
      if (
        claims.dispositions.some(
          (disposition) =>
            disposition.decision === "link" &&
            disposition.identityDigest === identityDigest,
        )
      ) {
        return fixedFailure("Hosted identity approved link candidate required");
      }

      return this.createPrincipal(
        transaction,
        input.issuer,
        input.subject,
        verifiedEmail,
      );
    });
  }

  async readAdmissionSnapshot(
    issuer: string,
  ): Promise<HostedIdentityAdmissionSnapshot> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return this.readAdmissionSnapshotInTransaction(transaction, issuer);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async readAuditSnapshot(
    issuer: string,
    subjects: string[],
  ): Promise<HostedIdentityAuditSnapshot> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const issuerColumn = await transaction.$queryRaw<
          Array<{ exists: boolean }>
        >(Prisma.sql`
          SELECT EXISTS (
            SELECT 1
            FROM pg_attribute attributes
            WHERE attributes.attrelid = to_regclass('external_identities')
              AND attributes.attname = 'issuer'
              AND attributes.attnum > 0
              AND NOT attributes.attisdropped
          ) AS "exists"
        `);
        if (!issuerColumn[0]?.exists) {
          const [snapshot, conflicts] = await Promise.all([
            this.readLegacyAuditSnapshotInTransaction(transaction),
            subjects.length === 0
              ? Promise.resolve([])
              : transaction.$queryRaw<Array<{ providerUserId: string }>>(
                  Prisma.sql`
                    SELECT identities."provider_user_id" AS "providerUserId"
                    FROM "external_identities" identities
                    WHERE identities."provider" = ${AUTH0_PROVIDER}
                      AND identities."provider_user_id" IN (${Prisma.join(subjects)})
                  `,
                ),
          ]);
          return {
            ...snapshot,
            conflictingSubjects: conflicts.map(
              (identity) => identity.providerUserId,
            ),
          };
        }

        const [snapshot, conflicts] = await Promise.all([
          this.readAdmissionSnapshotInTransaction(transaction, issuer),
          subjects.length === 0
            ? Promise.resolve([])
            : transaction.externalIdentity.findMany({
                where: {
                  provider: AUTH0_PROVIDER,
                  issuer: { in: [issuer, LEGACY_IDENTITY_ISSUER] },
                  providerUserId: { in: subjects },
                },
                select: { providerUserId: true },
              }),
        ]);
        return {
          ...snapshot,
          conflictingSubjects: conflicts.map(
            (identity) => identity.providerUserId,
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async readLegacyAuditSnapshotInTransaction(
    transaction: TransactionClient,
  ): Promise<HostedIdentityAdmissionSnapshot> {
    const [
      sentinelCounts,
      allUsers,
      zeroIdentityUsers,
      markedIdentities,
      hostedIdentities,
    ] = await Promise.all([
      transaction.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::integer AS "count"
        FROM "external_identities" identities
        WHERE identities."provider" = ${AUTH0_PROVIDER}
      `),
      transaction.$queryRaw<HostedIdentityAdmissionUser[]>(Prisma.sql`
        SELECT users."user_id" AS "userId", users."email" AS "email"
        FROM "users" users
        ORDER BY users."user_id" COLLATE "C"
      `),
      transaction.$queryRaw<HostedIdentityAdmissionUser[]>(Prisma.sql`
        SELECT users."user_id" AS "userId", users."email" AS "email"
        FROM "users" users
        WHERE NOT EXISTS (
          SELECT 1
          FROM "external_identities" identities
          WHERE identities."user_id" = users."user_id"
        )
        ORDER BY users."user_id" COLLATE "C"
      `),
      transaction.$queryRaw<HostedIdentityAdmissionMarker[]>(Prisma.sql`
        SELECT
          identities."id" AS "id",
          identities."user_id" AS "userId",
          identities."provider" AS "provider",
          ${LEGACY_IDENTITY_ISSUER}::text AS "issuer",
          identities."provider_user_id" AS "providerUserId",
          identities."metadata" AS "metadata",
          users."email" AS "email",
          (
            SELECT COUNT(*)::integer
            FROM "external_identities" user_identities
            WHERE user_identities."user_id" = identities."user_id"
          ) AS "identityCount"
        FROM "external_identities" identities
        JOIN "users" users ON users."user_id" = identities."user_id"
        WHERE identities."metadata" ? ${IDENTITY_LINK_CLAIM_METADATA_KEY}
        ORDER BY identities."id" COLLATE "C"
        LIMIT ${LINK_CLAIMS_MAX_MARKERS + 1}
      `),
      transaction.$queryRaw<HostedIdentityAdmissionSubject[]>(Prisma.sql`
        SELECT
          identities."id" AS "id",
          identities."user_id" AS "userId",
          ${LEGACY_IDENTITY_ISSUER}::text AS "issuer",
          identities."provider_user_id" AS "providerUserId"
        FROM "external_identities" identities
        WHERE identities."provider" = ${AUTH0_PROVIDER}
        ORDER BY identities."id" COLLATE "C"
      `),
    ]);
    return {
      sentinelRowCount: sentinelCounts[0]?.count ?? 0,
      allUsers,
      zeroIdentityUsers,
      markedIdentities,
      hostedIdentities,
    };
  }

  private async readAdmissionSnapshotInTransaction(
    transaction: TransactionClient,
    issuer: string,
  ): Promise<HostedIdentityAdmissionSnapshot> {
    const [
      sentinelRowCount,
      allUsers,
      zeroIdentityUsers,
      markedIdentities,
      hostedIdentities,
    ] = await Promise.all([
      transaction.externalIdentity.count({
        where: {
          provider: AUTH0_PROVIDER,
          issuer: LEGACY_IDENTITY_ISSUER,
        },
      }),
      transaction.user.findMany({
        select: { userId: true, email: true },
        orderBy: { userId: "asc" },
      }),
      transaction.user.findMany({
        where: { externalIdentities: { none: {} } },
        select: { userId: true, email: true },
        orderBy: { userId: "asc" },
      }),
      transaction.$queryRaw<HostedIdentityAdmissionMarker[]>(Prisma.sql`
          SELECT
            identities."id" AS "id",
            identities."user_id" AS "userId",
            identities."provider" AS "provider",
            identities."issuer" AS "issuer",
            identities."provider_user_id" AS "providerUserId",
            identities."metadata" AS "metadata",
            users."email" AS "email",
            (
              SELECT COUNT(*)::integer
              FROM "external_identities" user_identities
              WHERE user_identities."user_id" = identities."user_id"
            ) AS "identityCount"
          FROM "external_identities" identities
          JOIN "users" users ON users."user_id" = identities."user_id"
          WHERE identities."metadata" ? ${IDENTITY_LINK_CLAIM_METADATA_KEY}
          ORDER BY identities."id" COLLATE "C"
          LIMIT ${LINK_CLAIMS_MAX_MARKERS + 1}
        `),
      transaction.externalIdentity.findMany({
        where: {
          provider: AUTH0_PROVIDER,
          issuer: { in: [issuer, LEGACY_IDENTITY_ISSUER] },
        },
        select: {
          id: true,
          userId: true,
          issuer: true,
          providerUserId: true,
        },
        orderBy: { id: "asc" },
      }),
    ]);
    return {
      sentinelRowCount,
      allUsers,
      zeroIdentityUsers,
      markedIdentities,
      hostedIdentities,
    };
  }

  private async linkCandidate(
    transaction: TransactionClient,
    input: LinkOrCreateHostedIdentityInput,
    claims: IdentityLinkClaims,
    candidateRow: EmailCandidateRow,
  ): Promise<HostedIdentityResolution> {
    let canonicalCandidateEmail: string;
    try {
      canonicalCandidateEmail = canonicalizeIdentityLinkEmail(
        candidateRow.email,
      );
    } catch {
      return fixedFailure("Hosted identity candidate conflict");
    }
    if (
      canonicalCandidateEmail !== input.verifiedEmail ||
      isReservedIdentityLinkEmail(canonicalCandidateEmail) ||
      candidateRow.identityCount !== 0
    ) {
      return fixedFailure("Hosted identity candidate conflict");
    }

    const rowDigest = computeIdentityLinkRowDigest(
      candidateRow.userId,
      canonicalCandidateEmail,
    );
    const identityDigest = computeIdentityLinkIdentityDigest(
      input.issuer,
      input.subject,
    );
    const disposition = claims.dispositions.find(
      (entry) => entry.rowDigest === rowDigest,
    );
    if (
      disposition?.decision !== "link" ||
      disposition.identityDigest !== identityDigest
    ) {
      return fixedFailure("Hosted identity link not approved");
    }

    const candidate = await transaction.user.findUnique({
      where: { userId: candidateRow.userId },
      include: { externalIdentities: true },
    });
    if (
      !candidate ||
      candidate.email !== candidateRow.email ||
      candidate.externalIdentities.length !== 0 ||
      canonicalizeIdentityLinkEmail(candidate.email) !== canonicalCandidateEmail
    ) {
      return fixedFailure("Hosted identity candidate conflict");
    }

    await transaction.externalIdentity.create({
      data: {
        userId: candidate.userId,
        provider: AUTH0_PROVIDER,
        issuer: input.issuer,
        providerUserId: input.subject,
        metadata: {
          [IDENTITY_LINK_CLAIM_METADATA_KEY]: {
            version: 1,
            rowDigest,
            identityDigest,
          },
        },
      },
    });
    this.logger.log("Linked an approved hosted identity");
    return { outcome: "linked", user: asUser(candidate) };
  }

  private async createPrincipal(
    transaction: TransactionClient,
    issuer: string,
    subject: string,
    verifiedEmail: string | null,
  ): Promise<HostedIdentityResolution> {
    const userId = randomUUID();
    const user = await transaction.user.create({
      data: {
        userId,
        email: verifiedEmail ?? createSyntheticPrincipalEmail(userId),
      },
    });
    await transaction.externalIdentity.create({
      data: {
        userId: user.userId,
        provider: AUTH0_PROVIDER,
        issuer,
        providerUserId: subject,
        metadata: Prisma.JsonNull,
      },
    });
    this.logger.log("Created a hosted principal");
    return { outcome: "created", user: asUser(user) };
  }

  private async findEmailCandidates(
    transaction: TransactionClient,
    canonicalEmail: string,
  ): Promise<EmailCandidateRow[]> {
    const separator = canonicalEmail.indexOf("@");
    const localPart = canonicalEmail.slice(0, separator);
    const domain = canonicalEmail.slice(separator + 1);

    return transaction.$queryRaw<EmailCandidateRow[]>(Prisma.sql`
      SELECT
        users."user_id" AS "userId",
        users."email" AS "email",
        COUNT(identities."id")::integer AS "identityCount"
      FROM "users" users
      CROSS JOIN LATERAL (
        SELECT BTRIM(
          users."email",
          CHR(9) || CHR(10) || CHR(11) || CHR(12) || CHR(13) || ' '
        ) AS "trimmedEmail"
      ) normalized
      LEFT JOIN "external_identities" identities
        ON identities."user_id" = users."user_id"
      WHERE
        LEFT(
          normalized."trimmedEmail",
          STRPOS(normalized."trimmedEmail", '@') - 1
        ) COLLATE "C"
          = ${localPart} COLLATE "C"
        AND TRANSLATE(
          SUBSTRING(
            normalized."trimmedEmail"
            FROM STRPOS(normalized."trimmedEmail", '@') + 1
          ),
          ${ASCII_UPPER},
          ${ASCII_LOWER}
        ) COLLATE "C" = ${domain} COLLATE "C"
      GROUP BY users."user_id", users."email"
      ORDER BY users."user_id" COLLATE "C"
      LIMIT 2
    `);
  }

  private validateVerifiedEmail(value: string | null): string | null {
    if (value === null) {
      return null;
    }
    let canonical: string;
    try {
      canonical = canonicalizeIdentityLinkEmail(value);
    } catch {
      return fixedFailure("Invalid identity email assertion");
    }
    if (canonical !== value || isReservedIdentityLinkEmail(canonical)) {
      return fixedFailure("Invalid identity email assertion");
    }
    return canonical;
  }

  private async runSerializable<T>(
    operation: (transaction: TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !this.isRetryableConflict(error) ||
          attempt === SERIALIZABLE_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    return fixedFailure("Hosted identity transaction failed");
  }

  private isRetryableConflict(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
      meta?: { code?: string };
    };
    return (
      candidate.code === "P2002" ||
      candidate.code === "P2034" ||
      candidate.code === "40001" ||
      candidate.cause?.code === "40001" ||
      candidate.meta?.code === "40001"
    );
  }
}
